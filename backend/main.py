from __future__ import annotations

import logging
import os
import shutil
import threading
import uuid
from pathlib import Path
from typing import Any, Literal

from dotenv import load_dotenv
from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl

from backend.services.ai_analyzer import analyze_transcript
from backend.services.auth import current_user
from backend.services.credits import (
    InsufficientCreditsError,
    activate_subscription,
    credit_balance,
    reserve_credits,
    settle_credits,
)
from backend.services.downloader import download_video
from backend.services.paypal import get_subscription_config
from backend.services.subtitle_gen import generate_ass
from backend.services.transcriber import transcribe
from backend.services.video_processor import process_video

BASE_DIR = Path(__file__).resolve().parent
TEMP_DIR = BASE_DIR / "temp"
OUTPUT_DIR = BASE_DIR / "output"
TEMP_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)
load_dotenv(BASE_DIR.parent / ".env")
load_dotenv(BASE_DIR / ".env")

app = FastAPI(title="ClipFlow AI")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/output", StaticFiles(directory=OUTPUT_DIR), name="output")

_tasks: dict[str, dict[str, Any]] = {}
_tasks_lock = threading.Lock()
logger = logging.getLogger(__name__)
MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024
SUPPORTED_VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".mpeg", ".mpg"}


class ClipRequest(BaseModel):
    youtube_url: HttpUrl
    duration_seconds: Literal[30, 45, 55] = 45
    aspect_ratio: Literal["9:16", "1:1", "16:9"] = "9:16"
    resolution: Literal[720, 1080] = 1080
    subtitles: bool = True


class PayPalSubscriptionRequest(BaseModel):
    subscription_id: str


@app.get("/api/paypal/config")
def paypal_config() -> dict[str, str]:
    try:
        return get_subscription_config()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/paypal/verify")
def paypal_verify(
    request: PayPalSubscriptionRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    try:
        subscription = activate_subscription(user["uid"], request.subscription_id)
        return {
            **subscription,
            **credit_balance(user["uid"], subscription_active=True),
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/credits")
def get_credits(
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    try:
        return credit_balance(user["uid"])
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/clip", status_code=202)
def create_clip(
    request: ClipRequest,
    background_tasks: BackgroundTasks,
    _user: dict[str, Any] = Depends(current_user),
) -> dict[str, str]:
    task_id = str(uuid.uuid4())
    _reserve_task_credits(
        _user["uid"], task_id, request.duration_seconds, request.resolution
    )
    _create_task(_user["uid"], task_id)
    background_tasks.add_task(
        _run_pipeline,
        task_id,
        str(request.youtube_url),
        None,
        request.duration_seconds,
        request.aspect_ratio,
        request.resolution,
        request.subtitles,
    )
    return {"task_id": task_id}


@app.post("/api/clip/upload", status_code=202)
async def upload_clip(
    background_tasks: BackgroundTasks,
    _user: dict[str, Any] = Depends(current_user),
    video: UploadFile = File(...),
    duration_seconds: int = Form(45),
    aspect_ratio: Literal["9:16", "1:1", "16:9"] = Form("9:16"),
    resolution: int = Form(1080),
    subtitles: bool = Form(True),
) -> dict[str, str]:
    if duration_seconds not in {30, 45, 55}:
        raise HTTPException(
            status_code=422,
            detail="La durée doit être de 30, 45 ou 55 secondes.",
        )
    if resolution not in {720, 1080}:
        raise HTTPException(
            status_code=422,
            detail="La qualité doit être de 720p ou 1080p.",
        )

    suffix = Path(video.filename or "").suffix.lower()
    if suffix not in SUPPORTED_VIDEO_SUFFIXES:
        raise HTTPException(
            status_code=400,
            detail="Format vidéo non pris en charge. Utilisez MP4, MOV, MKV, WEBM, AVI ou MPEG.",
        )

    task_id = _create_task(_user["uid"])
    work_dir = TEMP_DIR / task_id
    work_dir.mkdir(parents=True, exist_ok=True)
    source = work_dir / f"source{suffix}"
    total_size = 0
    try:
        with source.open("wb") as target:
            while chunk := await video.read(1024 * 1024):
                total_size += len(chunk)
                if total_size > MAX_UPLOAD_SIZE:
                    raise HTTPException(
                        status_code=413,
                        detail="La vidéo dépasse la limite de 2 Go.",
                    )
                target.write(chunk)
    except Exception:
        shutil.rmtree(work_dir, ignore_errors=True)
        with _tasks_lock:
            _tasks.pop(task_id, None)
        raise
    finally:
        await video.close()

    if total_size == 0:
        shutil.rmtree(work_dir, ignore_errors=True)
        with _tasks_lock:
            _tasks.pop(task_id, None)
        raise HTTPException(status_code=400, detail="Le fichier vidéo est vide.")

    try:
        _reserve_task_credits(_user["uid"], task_id, duration_seconds, resolution)
    except Exception:
        shutil.rmtree(work_dir, ignore_errors=True)
        with _tasks_lock:
            _tasks.pop(task_id, None)
        raise

    background_tasks.add_task(
        _run_pipeline,
        task_id,
        None,
        source,
        duration_seconds,
        aspect_ratio,
        resolution,
        subtitles,
    )
    return {"task_id": task_id}


def _reserve_task_credits(
    user_id: str,
    task_id: str,
    duration_seconds: int,
    resolution: int,
) -> None:
    try:
        reserve_credits(user_id, task_id, duration_seconds, resolution)
    except InsufficientCreditsError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def _create_task(owner_uid: str, task_id: str | None = None) -> str:
    task_id = task_id or str(uuid.uuid4())
    with _tasks_lock:
        _tasks[task_id] = {
            "task_id": task_id,
            "owner_uid": owner_uid,
            "status": "queued",
            "progress": 0,
            "stage": "En attente",
            "message": None,
            "error": None,
            "video_url": None,
            "titre": None,
            "explication": None,
        }
    return task_id


@app.get("/api/status/{task_id}")
def get_status(
    task_id: str,
    _user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    with _tasks_lock:
        task = _tasks.get(task_id)
        if task is None or task["owner_uid"] != _user["uid"]:
            raise HTTPException(status_code=404, detail="Tâche inconnue.")
        return {key: value for key, value in task.items() if key != "owner_uid"}


def _update(task_id: str, **values: Any) -> None:
    with _tasks_lock:
        _tasks[task_id].update(values)


def _run_pipeline(
    task_id: str,
    url: str | None,
    uploaded_source: Path | None,
    target_duration: int,
    aspect_ratio: str,
    resolution: int,
    include_subtitles: bool,
) -> None:
    work_dir = TEMP_DIR / task_id
    stage = "Préparation vidéo"
    try:
        _update(task_id, status="processing", stage=stage)
        if uploaded_source is not None:
            source = uploaded_source
        elif url is not None:
            stage = "Téléchargement YouTube"
            _update(task_id, stage=stage)
            source = download_video(
                url,
                work_dir,
                lambda fraction: _update(task_id, progress=round(fraction * 20)),
                max_height=resolution,
            )
        else:
            raise RuntimeError("Aucune vidéo n'a été fournie.")

        stage = "Transcription Whisper"
        _update(task_id, progress=20, stage=stage)
        transcript = transcribe(
            source,
            lambda fraction: _update(task_id, progress=20 + round(fraction * 40)),
            model_name=os.getenv("WHISPER_MODEL", "tiny"),
        )

        stage = "Analyse Groq"
        _update(task_id, progress=60, stage=stage)
        duration = _probe_duration(source)
        selection = analyze_transcript(transcript, duration, target_duration)
        clip_duration = min(float(target_duration), duration)
        selection.start_time = max(
            0.0,
            min(
                selection.start_time
                + ((selection.end_time - selection.start_time) - clip_duration) / 2,
                duration - clip_duration,
            ),
        )
        selection.end_time = selection.start_time + clip_duration

        task_output = OUTPUT_DIR / task_id
        task_output.mkdir(parents=True, exist_ok=True)
        stage = "Génération des sous-titres"
        subtitles = (
            generate_ass(transcript, selection, task_output / "subtitles.ass")
            if include_subtitles
            else None
        )
        output_video = task_output / "clip.mp4"
        stage = "Montage FFmpeg"
        _update(task_id, progress=65, stage=stage)
        process_video(
            source,
            subtitles,
            output_video,
            selection,
            duration,
            lambda fraction: _update(task_id, progress=65 + round(fraction * 35)),
            aspect_ratio=aspect_ratio,
            resolution=resolution,
        )
        _update(
            task_id,
            status="completed",
            progress=100,
            stage="Terminé",
            video_url=f"/output/{task_id}/clip.mp4",
            titre=selection.titre,
            explication=selection.explication,
        )
        settle_credits(task_id, succeeded=True)
    except Exception as exc:
        logger.exception("La tâche Short %s a échoué pendant « %s ».", task_id, stage)
        try:
            settle_credits(task_id, succeeded=False)
        except Exception:
            logger.exception("Impossible de rembourser les jetons de la tâche %s.", task_id)
        _update(
            task_id,
            status="failed",
            stage=f"Échec · {stage}",
            error=str(exc),
        )
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def _probe_duration(path: Path) -> float:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise RuntimeError("ffprobe est introuvable. Installez FFmpeg et ajoutez-le au PATH.")
    import subprocess

    result = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    try:
        duration = float(result.stdout.strip())
    except ValueError as exc:
        raise RuntimeError("Impossible de déterminer la durée de la vidéo source.") from exc
    if duration < 30:
        raise RuntimeError("La vidéo source doit durer au moins 30 secondes.")
    return duration
