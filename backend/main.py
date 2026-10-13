from __future__ import annotations

import json
import logging
import math
import os
import shutil
import threading
import uuid
from datetime import datetime, timedelta, timezone
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
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl, field_validator

from backend.services.ai_analyzer import ClipSelection, analyze_transcript
from backend.services.auth import current_user
from backend.services.credits import (
    InsufficientCreditsError,
    activate_subscription,
    credit_balance,
    delete_task_history,
    get_task_history,
    list_task_history,
    record_task,
    reserve_credits,
    settle_credits,
    update_task_history,
)
from backend.services.downloader import download_video
from backend.services.paypal import get_subscription_config
from backend.services.subtitle_gen import generate_ass, validate_subtitle_color
from backend.services.transcriber import Transcript, Word, transcribe
from backend.services.video_processor import process_video

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR.parent / ".env")
load_dotenv(BASE_DIR / ".env")
MEDIA_STORAGE_PATH = Path(
    os.getenv("MEDIA_STORAGE_PATH", str(BASE_DIR))
).resolve()
TEMP_DIR = MEDIA_STORAGE_PATH / "temp"
OUTPUT_DIR = MEDIA_STORAGE_PATH / "output"
TEMP_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="GemClip")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip().rstrip("/")
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173",
        ).split(",")
        if origin.strip()
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
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
    subtitle_color: str = "#FFD400"
    subtitle_size: Literal["xsmall", "small", "medium", "large", "xlarge"] = "medium"
    subtitle_position: Literal["bottom", "center", "top"] = "bottom"
    subtitle_font: Literal["Arial", "DejaVu Sans", "Liberation Sans", "Noto Sans"] = "Arial"

    @field_validator("subtitle_color")
    @classmethod
    def validate_subtitle_color_value(cls, value: str) -> str:
        return validate_subtitle_color(value)


class PayPalSubscriptionRequest(BaseModel):
    subscription_id: str


class RenderClipRequest(BaseModel):
    start_time: float


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


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
    reservation = _reserve_task_credits(
        _user["uid"], task_id, request.duration_seconds, request.resolution
    )
    _create_task(
        _user["uid"],
        task_id,
        source="YouTube",
        duration_seconds=request.duration_seconds,
        resolution=request.resolution,
        aspect_ratio=request.aspect_ratio,
        subtitles=request.subtitles,
        subtitle_color=request.subtitle_color,
        subtitle_size=request.subtitle_size,
        subtitle_position=request.subtitle_position,
        subtitle_font=request.subtitle_font,
        credit_cost=reservation["cost"],
    )
    background_tasks.add_task(
        _run_pipeline,
        task_id,
        str(request.youtube_url),
        None,
        request.duration_seconds,
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
    subtitle_color: str = Form("#FFD400"),
    subtitle_size: Literal["xsmall", "small", "medium", "large", "xlarge"] = Form("medium"),
    subtitle_position: Literal["bottom", "center", "top"] = Form("bottom"),
    subtitle_font: Literal["Arial", "DejaVu Sans", "Liberation Sans", "Noto Sans"] = Form("Arial"),
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
    try:
        validate_subtitle_color(subtitle_color)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    suffix = Path(video.filename or "").suffix.lower()
    if suffix not in SUPPORTED_VIDEO_SUFFIXES:
        raise HTTPException(
            status_code=400,
            detail="Format vidéo non pris en charge. Utilisez MP4, MOV, MKV, WEBM, AVI ou MPEG.",
        )

    task_id = str(uuid.uuid4())
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
        raise HTTPException(status_code=400, detail="Le fichier vidéo est vide.")

    try:
        reservation = _reserve_task_credits(
            _user["uid"], task_id, duration_seconds, resolution
        )
    except Exception:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise

    try:
        _create_task(
            _user["uid"],
            task_id,
            source=Path(video.filename or "Vidéo importée").name,
            duration_seconds=duration_seconds,
            resolution=resolution,
            aspect_ratio=aspect_ratio,
            subtitles=subtitles,
            subtitle_color=subtitle_color,
            subtitle_size=subtitle_size,
            subtitle_position=subtitle_position,
            subtitle_font=subtitle_font,
            credit_cost=reservation["cost"],
        )
    except Exception:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise
    background_tasks.add_task(
        _run_pipeline,
        task_id,
        None,
        source,
        duration_seconds,
    )
    return {"task_id": task_id}


def _reserve_task_credits(
    user_id: str,
    task_id: str,
    duration_seconds: int,
    resolution: int,
) -> dict[str, Any]:
    try:
        return reserve_credits(user_id, task_id, duration_seconds, resolution)
    except InsufficientCreditsError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def _create_task(
    owner_uid: str,
    task_id: str | None = None,
    *,
    source: str = "Vidéo",
    duration_seconds: int = 45,
    resolution: int = 1080,
    aspect_ratio: str = "9:16",
    subtitles: bool = True,
    subtitle_color: str = "#FFD400",
    subtitle_size: str = "medium",
    subtitle_position: str = "bottom",
    subtitle_font: str = "Arial",
    credit_cost: int = 0,
) -> str:
    task_id = task_id or str(uuid.uuid4())
    task = {
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
        "source": source,
        "duration_seconds": duration_seconds,
        "resolution": resolution,
        "aspect_ratio": aspect_ratio,
        "subtitles": subtitles,
        "subtitle_color": subtitle_color,
        "subtitle_size": subtitle_size,
        "subtitle_position": subtitle_position,
        "subtitle_font": subtitle_font,
        "credit_cost": credit_cost,
    }
    try:
        record_task(
            task_id=task_id,
            user_id=owner_uid,
            source=source,
            duration_seconds=duration_seconds,
            resolution=resolution,
            aspect_ratio=aspect_ratio,
            subtitles=subtitles,
            subtitle_color=subtitle_color,
            subtitle_size=subtitle_size,
            subtitle_position=subtitle_position,
            subtitle_font=subtitle_font,
            credit_cost=credit_cost,
        )
    except Exception as exc:
        logger.exception("Impossible d’enregistrer la tâche Short %s dans l’historique.", task_id)
        try:
            settle_credits(task_id, succeeded=False)
        except Exception:
            logger.exception("Impossible de rembourser les jetons de la tâche %s.", task_id)
        raise HTTPException(
            status_code=503,
            detail="Impossible d’enregistrer cette création. Les jetons seront remboursés.",
        ) from exc
    with _tasks_lock:
        _tasks[task_id] = task
    return task_id


@app.get("/api/history")
def get_history(
    _user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    entries = list_task_history(_user["uid"])
    for entry in entries:
        if entry["status"] == "review":
            metadata = _load_review_metadata(entry["task_id"])
            if metadata is not None:
                entry.update(_public_review_metadata(metadata))
            else:
                _fail_review_task(
                    entry["task_id"],
                    "La vidéo source n’est plus disponible. Relancez la création du Short.",
                )
                entry.update(
                    status="failed",
                    stage="Sélection expirée",
                    error="La vidéo source n’est plus disponible. Relancez la création du Short.",
                )
    return entries


@app.post("/api/clip/{task_id}/render", status_code=202)
def render_selected_clip(
    task_id: str,
    request: RenderClipRequest,
    background_tasks: BackgroundTasks,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, str]:
    try:
        uuid.UUID(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Tâche inconnue.") from exc

    with _tasks_lock:
        task = _tasks.get(task_id)
    if task is None:
        task = get_task_history(task_id, user["uid"])
        if task is None:
            raise HTTPException(status_code=404, detail="Tâche inconnue.")
        task["owner_uid"] = user["uid"]
        with _tasks_lock:
            _tasks[task_id] = task
    elif task.get("owner_uid") != user["uid"]:
        raise HTTPException(status_code=404, detail="Tâche inconnue.")

    metadata = _load_review_metadata(task_id)
    if task.get("status") != "review" or metadata is None:
        if task.get("status") == "review" and metadata is None:
            _fail_review_task(
                task_id,
                "La vidéo source n’est plus disponible. Relancez la création du Short.",
            )
        raise HTTPException(
            status_code=409,
            detail="Ce Short n’est plus en attente d’ajustement.",
        )

    start_time = request.start_time
    clip_duration = float(metadata["clip_duration"])
    source_duration = float(metadata["source_duration"])
    max_start = source_duration - clip_duration
    if not math.isfinite(start_time) or start_time < 0 or start_time > max_start:
        raise HTTPException(
            status_code=422,
            detail="Le début du Short doit rester dans la durée de la vidéo source.",
        )

    work_dir = TEMP_DIR / task_id
    source_name = metadata.get("source_name")
    if not isinstance(source_name, str) or Path(source_name).name != source_name:
        raise HTTPException(status_code=410, detail="La vidéo source n’est plus disponible.")
    source = work_dir / source_name
    if not source.is_file() or source.resolve().parent != work_dir.resolve():
        raise HTTPException(status_code=410, detail="La vidéo source n’est plus disponible.")

    with _tasks_lock:
        if task.get("status") != "review":
            raise HTTPException(
                status_code=409,
                detail="Le rendu de ce Short a déjà été lancé.",
            )
        task.update(
            status="processing",
            progress=65,
            stage="Montage FFmpeg",
            selection_start=start_time,
            selection_end=start_time + clip_duration,
        )
    metadata["selection_start"] = start_time
    review_path = work_dir / "review.json"
    try:
        review_path.write_text(json.dumps(metadata), encoding="utf-8")
        update_task_history(
            task_id,
            {"status": "processing", "progress": 65, "stage": "Montage FFmpeg"},
        )
    except OSError as exc:
        with _tasks_lock:
            task.update(status="review", stage="Passage sélectionné")
        raise HTTPException(
            status_code=500,
            detail="Impossible d’enregistrer l’ajustement de ce Short.",
        ) from exc

    background_tasks.add_task(
        _render_selected_clip,
        task_id,
        task,
        metadata,
        source,
        start_time,
    )
    return {"task_id": task_id}


@app.delete("/api/history/{task_id}")
def delete_history(
    task_id: str,
    _user: dict[str, Any] = Depends(current_user),
) -> dict[str, bool]:
    history_entry = get_task_history(task_id, _user["uid"])
    review_was_pending = history_entry is not None and history_entry["status"] == "review"
    deleted = delete_task_history(task_id, _user["uid"])
    with _tasks_lock:
        if task_id in _tasks and _tasks[task_id].get("owner_uid") == _user["uid"]:
            review_was_pending = _tasks[task_id].get("status") == "review"
            _tasks.pop(task_id, None)
    if deleted and review_was_pending:
        shutil.rmtree(TEMP_DIR / task_id, ignore_errors=True)
    return {"deleted": deleted}


@app.get("/api/history/{task_id}/download")
def download_history_video(
    task_id: str,
    _user: dict[str, Any] = Depends(current_user),
) -> FileResponse:
    try:
        uuid.UUID(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Vidéo introuvable.") from exc

    history_entry = get_task_history(task_id, _user["uid"])
    if history_entry is None or history_entry["status"] != "completed":
        raise HTTPException(status_code=404, detail="Vidéo introuvable.")

    video_path = OUTPUT_DIR / task_id / "clip.mp4"
    if not video_path.is_file():
        raise HTTPException(status_code=404, detail="Fichier vidéo introuvable.")

    return FileResponse(
        video_path,
        media_type="video/mp4",
        filename=f"gemclip-{task_id}.mp4",
        headers={"Cache-Control": "private, no-store"},
    )



@app.get("/api/status/{task_id}")
def get_status(
    task_id: str,
    _user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    with _tasks_lock:
        task = _tasks.get(task_id)
        owned_task = task is not None and task["owner_uid"] == _user["uid"]
    if owned_task and task is not None:
        if task["status"] == "review":
            metadata = _load_review_metadata(task_id)
            if metadata is not None:
                task.update(_public_review_metadata(metadata))
        return {key: value for key, value in task.items() if key != "owner_uid"}
    history_entry = get_task_history(task_id, _user["uid"])
    if history_entry is None:
        raise HTTPException(status_code=404, detail="Tâche inconnue.")
    if history_entry["status"] == "review":
        metadata = _load_review_metadata(task_id)
        if metadata is not None:
            history_entry.update(_public_review_metadata(metadata))
        else:
            error = "La vidéo source n’est plus disponible. Relancez la création du Short."
            _fail_review_task(task_id, error)
            history_entry.update(status="failed", stage="Sélection expirée", error=error)
    return history_entry


def _update(task_id: str, **values: Any) -> None:
    with _tasks_lock:
        _tasks[task_id].update(values)
    update_task_history(task_id, values)


def _run_pipeline(
    task_id: str,
    url: str | None,
    uploaded_source: Path | None,
    target_duration: int,
) -> None:
    work_dir = TEMP_DIR / task_id
    stage = "Préparation vidéo"
    keep_for_review = False
    try:
        _update(task_id, status="processing", stage=stage)
        with _tasks_lock:
            task_options = _tasks[task_id].copy()
        if uploaded_source is not None:
            source = uploaded_source
        elif url is not None:
            stage = "Téléchargement YouTube"
            _update(task_id, stage=stage)
            source = download_video(
                url,
                work_dir,
                lambda fraction: _update(task_id, progress=round(fraction * 20)),
                max_height=task_options["resolution"],
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
        review_metadata = {
            "source_name": source.name,
            "source_duration": duration,
            "clip_duration": clip_duration,
            "selection_start": selection.start_time,
            "titre": selection.titre,
            "explication": selection.explication,
            "expires_at": (
                datetime.now(timezone.utc) + timedelta(hours=24)
            ).isoformat(),
            "words": [
                {"start": word.start, "end": word.end, "text": word.text}
                for word in transcript.words
            ],
        }
        (work_dir / "review.json").write_text(
            json.dumps(review_metadata),
            encoding="utf-8",
        )
        _update(
            task_id,
            status="review",
            progress=60,
            stage="Passage sélectionné",
            titre=selection.titre,
            explication=selection.explication,
            selection_start=selection.start_time,
            selection_end=selection.end_time,
            source_duration=duration,
        )
        keep_for_review = True
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
        if not keep_for_review:
            shutil.rmtree(work_dir, ignore_errors=True)


def _load_review_metadata(task_id: str) -> dict[str, Any] | None:
    try:
        uuid.UUID(task_id)
        value = json.loads((TEMP_DIR / task_id / "review.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict):
        return None
    expires_at = value.get("expires_at")
    if isinstance(expires_at, str):
        try:
            expired = datetime.fromisoformat(expires_at) <= datetime.now(timezone.utc)
        except ValueError:
            expired = True
        if expired:
            shutil.rmtree(TEMP_DIR / task_id, ignore_errors=True)
            _fail_review_task(
                task_id,
                "Le passage sélectionné a expiré. Relancez la création du Short.",
            )
            return None
    source_name = value.get("source_name")
    if (
        not isinstance(source_name, str)
        or Path(source_name).name != source_name
        or not (TEMP_DIR / task_id / source_name).is_file()
    ):
        shutil.rmtree(TEMP_DIR / task_id, ignore_errors=True)
        _fail_review_task(
            task_id,
            "La vidéo source n’est plus disponible. Relancez la création du Short.",
        )
        return None
    return value


def _fail_review_task(task_id: str, error: str) -> None:
    values = {"status": "failed", "stage": "Sélection expirée", "error": error}
    with _tasks_lock:
        task = _tasks.get(task_id)
        if task is not None:
            task.update(values)
    update_task_history(task_id, values)
    try:
        settle_credits(task_id, succeeded=False)
    except Exception:
        logger.exception("Impossible de rembourser les jetons de la tâche %s.", task_id)
        raise


def _public_review_metadata(metadata: dict[str, Any]) -> dict[str, float]:
    start_time = float(metadata["selection_start"])
    clip_duration = float(metadata["clip_duration"])
    return {
        "selection_start": start_time,
        "selection_end": start_time + clip_duration,
        "source_duration": float(metadata["source_duration"]),
    }


def _render_selected_clip(
    task_id: str,
    task: dict[str, Any],
    metadata: dict[str, Any],
    source: Path,
    start_time: float,
) -> None:
    work_dir = TEMP_DIR / task_id
    stage = "Génération des sous-titres"
    try:
        transcript = Transcript(
            words=[
                Word(
                    start=float(word["start"]),
                    end=float(word["end"]),
                    text=str(word["text"]),
                )
                for word in metadata["words"]
            ],
            text="",
        )
        selection = ClipSelection(
            start_time=start_time,
            end_time=start_time + float(metadata["clip_duration"]),
            titre=str(metadata["titre"]),
            explication=str(metadata["explication"]),
        )
        task_output = OUTPUT_DIR / task_id
        task_output.mkdir(parents=True, exist_ok=True)
        subtitles = (
            generate_ass(
                transcript,
                selection,
                task_output / "subtitles.ass",
                color=task["subtitle_color"],
                size=task["subtitle_size"],
                position=task["subtitle_position"],
                font=task["subtitle_font"],
            )
            if task["subtitles"]
            else None
        )
        stage = "Montage FFmpeg"
        _update(task_id, progress=65, stage=stage)
        process_video(
            source,
            subtitles,
            task_output / "clip.mp4",
            selection,
            float(metadata["source_duration"]),
            lambda fraction: _update(task_id, progress=65 + round(fraction * 35)),
            aspect_ratio=task["aspect_ratio"],
            resolution=task["resolution"],
        )
        _update(
            task_id,
            status="completed",
            progress=100,
            stage="Terminé",
            video_url=f"/api/history/{task_id}/download",
            titre=selection.titre,
            explication=selection.explication,
            selection_start=selection.start_time,
            selection_end=selection.end_time,
            source_duration=float(metadata["source_duration"]),
        )
        settle_credits(task_id, succeeded=True)
    except Exception as exc:
        logger.exception("Le rendu du Short %s a échoué pendant « %s ».", task_id, stage)
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
