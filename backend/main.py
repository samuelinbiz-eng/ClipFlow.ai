from __future__ import annotations

import json
import logging
import math
import os
import shutil
import secrets
import sys
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import gettempdir
from typing import Any, Literal

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dotenv import load_dotenv
from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from starlette.background import BackgroundTask
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, HttpUrl, ValidationError, field_validator

if __package__:
    from backend.services.credits import (
        MAX_OUTPUT_BYTES,
        MAX_UPLOAD_BYTES,
        InsufficientCreditsError,
        StorageQuotaError,
        activate_subscription,
        attach_upload_to_task,
        claim_next_task,
        complete_task_storage,
        complete_upload_storage,
        credit_balance,
        delete_task_history,
        expire_upload_reservations,
        get_media_upload,
        get_task_history,
        get_task_payload,
        list_abandoned_reviews,
        list_expired_tasks,
        list_task_history,
        record_task,
        release_task_storage,
        reserve_credits,
        reserve_task_storage,
        reserve_upload_storage,
        save_task_payload,
        set_task_job_status,
        short_cost,
        settle_credits,
        update_task_history,
        update_task_source_storage,
    )
    from backend.services.auth import current_user
    from backend.services.paypal import get_subscription_config
    from backend.services.subtitle_gen import validate_subtitle_color
else:
    from services.credits import (
        MAX_OUTPUT_BYTES,
        MAX_UPLOAD_BYTES,
        InsufficientCreditsError,
        StorageQuotaError,
        activate_subscription,
        attach_upload_to_task,
        claim_next_task,
        complete_task_storage,
        complete_upload_storage,
        credit_balance,
        delete_task_history,
        expire_upload_reservations,
        get_media_upload,
        get_task_history,
        get_task_payload,
        list_abandoned_reviews,
        list_expired_tasks,
        list_task_history,
        record_task,
        release_task_storage,
        reserve_credits,
        reserve_task_storage,
        reserve_upload_storage,
        save_task_payload,
        set_task_job_status,
        short_cost,
        settle_credits,
        update_task_history,
        update_task_source_storage,
    )
    from services.auth import current_user
    from services.paypal import get_subscription_config
    from services.subtitle_gen import validate_subtitle_color

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR.parent / ".env")
load_dotenv(BASE_DIR / ".env")
_default_media_path = (
    Path(gettempdir()) / "gemclip"
    if os.getenv("VERCEL")
    else BASE_DIR
)
MEDIA_STORAGE_PATH = Path(os.getenv("MEDIA_STORAGE_PATH", str(_default_media_path))).resolve()
TEMP_DIR = MEDIA_STORAGE_PATH / "temp"
OUTPUT_DIR = MEDIA_STORAGE_PATH / "output"
TEMP_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
_tasks: dict[str, dict[str, Any]] = {}
_tasks_lock = threading.Lock()

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
logger = logging.getLogger(__name__)
MAX_UPLOAD_SIZE = MAX_UPLOAD_BYTES
SUPPORTED_VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".mpeg", ".mpg"}


class ClipOptions(BaseModel):
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


class ClipRequest(ClipOptions):
    youtube_url: HttpUrl


class UploadedClipRequest(ClipOptions):
    upload_id: str


class PayPalSubscriptionRequest(BaseModel):
    subscription_id: str


class RenderClipRequest(BaseModel):
    start_time: float
    aspect_ratio: Literal["9:16", "1:1", "16:9"] | None = None
    subtitles: bool | None = None
    subtitle_color: str | None = None
    subtitle_size: Literal["xsmall", "small", "medium", "large", "xlarge"] | None = None
    subtitle_position: Literal["bottom", "center", "top"] | None = None
    subtitle_font: Literal["Arial", "DejaVu Sans", "Liberation Sans", "Noto Sans"] | None = None

    @field_validator("subtitle_color")
    @classmethod
    def validate_subtitle_color_value(cls, value: str | None) -> str | None:
        return validate_subtitle_color(value) if value is not None else None


class BlobUploadReservationRequest(BaseModel):
    upload_id: str
    pathname: str


class BlobUploadCompletionRequest(BaseModel):
    upload_id: str
    pathname: str
    blob_url: HttpUrl
    size: int


class BlobUploadFinalizeRequest(BaseModel):
    upload_id: str
    pathname: str
    blob_url: HttpUrl


class WorkerWord(BaseModel):
    start: float
    end: float
    text: str


class WorkerAnalysisRequest(BaseModel):
    words: list[WorkerWord] = Field(max_length=30000)
    duration: float
    target_duration: Literal[30, 45, 55]


class WorkerProgressRequest(BaseModel):
    task_id: str
    progress: int = Field(ge=0, le=100)
    stage: str = Field(min_length=1, max_length=120)


class WorkerCompletionRequest(BaseModel):
    task_id: str
    status: Literal["review", "completed", "failed"]
    source_url: HttpUrl | None = None
    source_bytes: int | None = Field(default=None, ge=1, le=MAX_UPLOAD_BYTES)
    source_duration: float | None = None
    clip_duration: float | None = None
    selection_start: float | None = None
    titre: str | None = None
    explication: str | None = None
    words: list[WorkerWord] | None = Field(default=None, max_length=30000)
    output_url: HttpUrl | None = None
    output_bytes: int | None = Field(default=None, ge=1, le=MAX_OUTPUT_BYTES)
    error: str | None = Field(default=None, max_length=1200)


class WorkerCleanupResponse(BaseModel):
    deleted: int


def _is_vercel() -> bool:
    return bool(os.getenv("VERCEL"))


def _verify_worker(request: Request) -> None:
    expected = os.getenv("GEMCLIP_WORKER_SECRET", "")
    supplied = request.headers.get("X-GemClip-Worker-Secret", "")
    if not expected:
        raise HTTPException(status_code=503, detail="Le worker vidéo n’est pas configuré.")
    if not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Authentification du worker invalide.")


def _delete_blob(blob_url: str | None) -> None:
    if not blob_url:
        return
    from vercel.blob import delete as delete_blob

    delete_blob(blob_url)


def _create_cloud_task(
    *,
    task_id: str,
    user_id: str,
    source: str,
    options: ClipOptions,
    payload: dict[str, Any],
    storage_reserved: bool = False,
) -> None:
    if not storage_reserved:
        try:
            reserve_task_storage(task_id, user_id)
        except StorageQuotaError as exc:
            settle_credits(task_id, succeeded=False)
            raise HTTPException(status_code=429, detail=str(exc)) from exc

    try:
        record_task(
            task_id=task_id,
            user_id=user_id,
            source=source,
            duration_seconds=options.duration_seconds,
            resolution=options.resolution,
            aspect_ratio=options.aspect_ratio,
            subtitles=options.subtitles,
            subtitle_color=options.subtitle_color,
            subtitle_size=options.subtitle_size,
            subtitle_position=options.subtitle_position,
            subtitle_font=options.subtitle_font,
            credit_cost=short_cost(options.duration_seconds, options.resolution),
        )
        save_task_payload(task_id, payload)
    except Exception as exc:
        release_task_storage(task_id)
        delete_task_history(task_id, user_id)
        settle_credits(task_id, succeeded=False)
        logger.exception("Impossible d’enregistrer la tâche Vercel %s.", task_id)
        raise HTTPException(
            status_code=503,
            detail="Impossible d’enregistrer cette création. Les jetons seront remboursés.",
        ) from exc


@app.post("/api/blob-upload/reserve")
def reserve_blob_upload(
    request: BlobUploadReservationRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, str]:
    try:
        upload_id = str(uuid.UUID(request.upload_id))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Identifiant de téléversement invalide.") from exc
    filename = request.pathname.rsplit("/", 1)[-1]
    suffix = Path(filename).suffix.lower()
    if (
        request.pathname != f"uploads/{user['uid']}/{upload_id}{suffix}"
        or suffix not in SUPPORTED_VIDEO_SUFFIXES
    ):
        raise HTTPException(status_code=422, detail="Chemin de téléversement invalide.")
    try:
        reserve_upload_storage(user["uid"], upload_id, request.pathname)
    except StorageQuotaError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"upload_id": upload_id}


@app.post("/api/blob-upload/complete")
def complete_blob_upload(
    request: BlobUploadCompletionRequest,
    worker_request: Request,
) -> dict[str, bool]:
    _verify_worker(worker_request)
    try:
        complete_upload_storage(
            request.upload_id,
            request.pathname,
            str(request.blob_url),
            request.size,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"completed": True}


@app.post("/api/blob-upload/finalize")
def finalize_blob_upload(
    request: BlobUploadFinalizeRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, bool]:
    try:
        upload_id = str(uuid.UUID(request.upload_id))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Identifiant de téléversement invalide.") from exc
    upload = get_media_upload(upload_id, user["uid"])
    if upload is None or upload["pathname"] != request.pathname:
        raise HTTPException(status_code=404, detail="Réservation de téléversement introuvable.")
    if upload["status"] == "uploaded":
        if upload["blob_url"] != str(request.blob_url):
            raise HTTPException(status_code=409, detail="Ce téléversement a déjà été finalisé.")
        return {"completed": True}
    if upload["status"] != "reserved":
        raise HTTPException(status_code=409, detail="Ce téléversement n’est plus valide.")
    if not request.blob_url.host.endswith(".private.blob.vercel-storage.com"):
        raise HTTPException(status_code=422, detail="Le fichier doit être stocké dans le Blob privé GemClip.")

    from vercel.blob import BlobClient

    try:
        with BlobClient() as blob_client:
            blob = blob_client.head(str(request.blob_url))
    except Exception as exc:
        logger.exception("Impossible de vérifier le Blob importé %s.", upload_id)
        raise HTTPException(status_code=502, detail="Impossible de vérifier le téléversement.") from exc
    if blob.pathname != upload["pathname"] or blob.size is None:
        raise HTTPException(status_code=422, detail="Le fichier importé ne correspond pas à sa réservation.")
    try:
        complete_upload_storage(
            upload_id,
            upload["pathname"],
            blob.url,
            blob.size,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"completed": True}


@app.post("/api/worker/claim")
def worker_claim(request: Request) -> dict[str, Any] | None:
    _verify_worker(request)
    task = claim_next_task()
    if task is None:
        return None
    return {
        "task_id": task["task_id"],
        "user_id": task["user_id"],
        "status": task["status"],
        "progress": task["progress"],
        "stage": task["stage"],
        "source": task["source"],
        "duration_seconds": task["duration_seconds"],
        "resolution": task["resolution"],
        "aspect_ratio": task["aspect_ratio"],
        "subtitles": bool(task["subtitles"]),
        "subtitle_color": task["subtitle_color"],
        "subtitle_size": task["subtitle_size"],
        "subtitle_position": task["subtitle_position"],
        "subtitle_font": task["subtitle_font"],
        "payload": task["payload"],
    }


@app.post("/api/worker/analyze")
def worker_analyze(
    request: WorkerAnalysisRequest,
    worker_request: Request,
) -> dict[str, Any]:
    _verify_worker(worker_request)
    if __package__:
        from backend.services.ai_analyzer import analyze_transcript
        from backend.services.transcriber import Transcript, Word
    else:
        from services.ai_analyzer import analyze_transcript
        from services.transcriber import Transcript, Word

    words = [
        Word(start=word.start, end=word.end, text=word.text)
        for word in request.words
    ]
    try:
        selection = analyze_transcript(
            Transcript(words=words, text=" ".join(word.text for word in words)),
            request.duration,
            request.target_duration,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {
        "start_time": selection.start_time,
        "end_time": selection.end_time,
        "titre": selection.titre,
        "explication": selection.explication,
    }


@app.post("/api/worker/progress")
def worker_progress(
    request: WorkerProgressRequest,
    worker_request: Request,
) -> dict[str, bool]:
    _verify_worker(worker_request)
    if get_task_payload(request.task_id) is None:
        raise HTTPException(status_code=404, detail="Tâche inconnue.")
    update_task_history(
        request.task_id,
        {"progress": request.progress, "stage": request.stage, "status": "processing"},
    )
    return {"updated": True}


@app.post("/api/worker/complete")
def worker_complete(
    request: WorkerCompletionRequest,
    worker_request: Request,
) -> dict[str, bool]:
    _verify_worker(worker_request)
    payload = get_task_payload(request.task_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Tâche inconnue.")

    if request.status == "failed":
        source_url = payload.get("source_blob_url")
        try:
            _delete_blob(source_url)
        except Exception as exc:
            logger.exception("Impossible de supprimer le média temporaire de %s.", request.task_id)
            raise HTTPException(
                status_code=502,
                detail="Échec du nettoyage du média temporaire.",
            ) from exc
        release_task_storage(request.task_id)
        update_task_history(
            request.task_id,
            {
                "status": "failed",
                "stage": "Échec du traitement",
                "error": request.error or "Le traitement vidéo a échoué.",
            },
        )
        settle_credits(request.task_id, succeeded=False)
        payload.update(job_kind=None, source_blob_url=None, review=None)
        set_task_job_status(request.task_id, payload, "idle")
        return {"completed": True}

    if request.status == "review":
        if (
            payload.get("job_kind") != "analyze"
            or request.source_url is None
            or request.source_bytes is None
            or request.source_duration is None
            or request.clip_duration is None
            or request.selection_start is None
            or request.titre is None
            or request.explication is None
            or request.words is None
        ):
            raise HTTPException(status_code=422, detail="Résultat d’analyse incomplet.")
        try:
            update_task_source_storage(
                request.task_id,
                str(request.source_url),
                request.source_bytes,
            )
        except (StorageQuotaError, ValueError) as exc:
            _delete_blob(str(request.source_url))
            release_task_storage(request.task_id)
            update_task_history(
                request.task_id,
                {
                    "status": "failed",
                    "stage": "Échec · stockage",
                    "error": str(exc),
                },
            )
            settle_credits(request.task_id, succeeded=False)
            payload.update(job_kind=None, source_blob_url=None, review=None)
            set_task_job_status(request.task_id, payload, "idle")
            raise HTTPException(status_code=429, detail=str(exc)) from exc

        review = {
            "source_duration": request.source_duration,
            "clip_duration": request.clip_duration,
            "selection_start": request.selection_start,
            "titre": request.titre,
            "explication": request.explication,
            "expires_at": (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(),
            "words": [word.model_dump() for word in request.words],
        }
        payload.update(
            job_kind=None,
            source_blob_url=str(request.source_url),
            review=review,
        )
        update_task_history(
            request.task_id,
            {
                "status": "review",
                "progress": 60,
                "stage": "Passage sélectionné",
                "titre": request.titre,
                "explication": request.explication,
            },
        )
        set_task_job_status(request.task_id, payload, "idle")
        return {"completed": True}

    if (
        payload.get("job_kind") != "render"
        or request.output_url is None
        or request.output_bytes is None
    ):
        raise HTTPException(status_code=422, detail="Résultat du montage incomplet.")
    review = payload.get("review")
    if not isinstance(review, dict):
        raise HTTPException(status_code=409, detail="Les données de sélection sont introuvables.")
    try:
        _delete_blob(payload.get("source_blob_url"))
        complete_task_storage(request.task_id, request.output_bytes)
    except Exception as exc:
        logger.exception("Impossible de finaliser le stockage de %s.", request.task_id)
        raise HTTPException(status_code=502, detail="Impossible de finaliser le Short.") from exc

    payload.update(
        job_kind=None,
        source_blob_url=None,
        output_blob_url=str(request.output_url),
    )
    update_task_history(
        request.task_id,
        {
            "status": "completed",
            "progress": 100,
            "stage": "Terminé",
            "video_url": f"/api/history/{request.task_id}/download",
            "titre": str(review["titre"]),
            "explication": str(review["explication"]),
        },
    )
    set_task_job_status(request.task_id, payload, "idle")
    settle_credits(request.task_id, succeeded=True)
    return {"completed": True}


@app.post("/api/worker/cleanup", response_model=WorkerCleanupResponse)
def worker_cleanup(request: Request) -> WorkerCleanupResponse:
    _verify_worker(request)
    deleted = 0
    now = datetime.now(timezone.utc)

    for upload in expire_upload_reservations((now - timedelta(hours=1)).isoformat()):
        try:
            _delete_blob(upload.get("blob_url"))
        except Exception as exc:
            logger.exception("Impossible de supprimer le téléversement expiré %s.", upload["upload_id"])
            raise HTTPException(status_code=502, detail="Échec du nettoyage des imports expirés.") from exc
        release_task_storage(upload["upload_id"])
        deleted += 1

    for task in list_abandoned_reviews((now - timedelta(hours=24)).isoformat()):
        source_url = task["payload"].get("source_blob_url")
        try:
            _delete_blob(source_url)
        except Exception as exc:
            logger.exception("Impossible de supprimer la source expirée de %s.", task["task_id"])
            raise HTTPException(status_code=502, detail="Échec du nettoyage des sources expirées.") from exc
        release_task_storage(task["task_id"])
        update_task_history(
            task["task_id"],
            {
                "status": "failed",
                "stage": "Sélection expirée",
                "error": "Le passage sélectionné a expiré. Relancez la création du Short.",
            },
        )
        settle_credits(task["task_id"], succeeded=False)
        payload = task["payload"]
        payload.update(job_kind=None, source_blob_url=None, review=None)
        set_task_job_status(task["task_id"], payload, "idle")
        deleted += 1

    for task in list_expired_tasks((now - timedelta(days=30)).isoformat()):
        payload = task["payload"]
        for key in ("source_blob_url", "output_blob_url"):
            try:
                _delete_blob(payload.get(key))
            except Exception as exc:
                logger.exception("Impossible de supprimer le média expiré de %s.", task["task_id"])
                raise HTTPException(status_code=502, detail="Échec du nettoyage des médias expirés.") from exc
        delete_task_history(task["task_id"], task["user_id"])
        deleted += 1

    return WorkerCleanupResponse(deleted=deleted)


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
    if _is_vercel():
        payload = {
            "job_kind": "analyze",
            "source_kind": "youtube",
            "youtube_url": str(request.youtube_url),
            "options": request.model_dump(exclude={"youtube_url"}),
        }
        _create_cloud_task(
            task_id=task_id,
            user_id=_user["uid"],
            source="YouTube",
            options=request,
            payload=payload,
        )
        return {"task_id": task_id}

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
    request: Request,
    background_tasks: BackgroundTasks,
    _user: dict[str, Any] = Depends(current_user),
) -> dict[str, str]:
    if request.headers.get("content-type", "").startswith("application/json"):
        if not _is_vercel():
            raise HTTPException(
                status_code=503,
                detail="Les imports directs nécessitent le stockage Blob Vercel.",
            )
        try:
            upload_request = UploadedClipRequest.model_validate(await request.json())
            upload_id = str(uuid.UUID(upload_request.upload_id))
        except (ValidationError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="Paramètres d’import invalides.") from exc

        upload = get_media_upload(upload_id, _user["uid"])
        if upload is None or upload["status"] != "uploaded" or not upload["blob_url"]:
            raise HTTPException(status_code=410, detail="Le téléversement est introuvable ou expiré.")

        task_id = str(uuid.uuid4())
        try:
            reservation = _reserve_task_credits(
                _user["uid"],
                task_id,
                upload_request.duration_seconds,
                upload_request.resolution,
            )
        except HTTPException:
            _delete_blob(upload["blob_url"])
            release_task_storage(upload_id)
            raise
        try:
            upload = attach_upload_to_task(upload_id, _user["uid"], task_id)
        except ValueError as exc:
            settle_credits(task_id, succeeded=False)
            release_task_storage(upload_id)
            try:
                _delete_blob(upload["blob_url"])
            except Exception:
                logger.exception("Impossible de nettoyer l’import refusé %s.", upload_id)
            raise HTTPException(status_code=409, detail=str(exc)) from exc

        payload = {
            "job_kind": "analyze",
            "source_kind": "upload",
            "source_blob_url": upload["blob_url"],
            "source_filename": Path(upload["pathname"]).name,
            "options": upload_request.model_dump(exclude={"upload_id"}),
        }
        try:
            _create_cloud_task(
                task_id=task_id,
                user_id=_user["uid"],
                source=Path(upload["pathname"]).name,
                options=upload_request,
                payload=payload,
                storage_reserved=True,
            )
        except HTTPException:
            try:
                _delete_blob(upload["blob_url"])
            except Exception:
                logger.exception("Impossible de nettoyer l’import après l’échec %s.", upload_id)
            raise
        return {"task_id": task_id}

    if _is_vercel():
        raise HTTPException(status_code=415, detail="Un import Vercel doit être envoyé en stockage direct.")

    form = await request.form()
    video = form.get("video")
    if not isinstance(video, UploadFile):
        raise HTTPException(status_code=400, detail="Sélectionnez un fichier vidéo.")
    try:
        options = ClipOptions.model_validate(
            {
                key: form.get(key)
                for key in (
                    "duration_seconds",
                    "aspect_ratio",
                    "resolution",
                    "subtitles",
                    "subtitle_color",
                    "subtitle_size",
                    "subtitle_position",
                    "subtitle_font",
                )
                if form.get(key) is not None
            }
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail="Options vidéo invalides.") from exc

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
                        detail="La vidéo dépasse la limite gratuite de 250 Mo.",
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
            _user["uid"], task_id, options.duration_seconds, options.resolution
        )
    except Exception:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise

    try:
        _create_task(
            _user["uid"],
            task_id,
            source=Path(video.filename or "Vidéo importée").name,
            duration_seconds=options.duration_seconds,
            resolution=options.resolution,
            aspect_ratio=options.aspect_ratio,
            subtitles=options.subtitles,
            subtitle_color=options.subtitle_color,
            subtitle_size=options.subtitle_size,
            subtitle_position=options.subtitle_position,
            subtitle_font=options.subtitle_font,
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
        options.duration_seconds,
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
            payload = get_task_payload(entry["task_id"]) if _is_vercel() else None
            metadata = (
                payload.get("review")
                if isinstance(payload, dict)
                else _load_review_metadata(entry["task_id"])
            )
            if metadata is not None:
                entry.update(_public_review_metadata(metadata))
            elif _is_vercel():
                error = "La vidéo source n’est plus disponible. Relancez la création du Short."
                _fail_cloud_review(entry["task_id"], payload, error)
                entry.update(status="failed", stage="Sélection expirée", error=error)
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

    payload = get_task_payload(task_id) if _is_vercel() else None
    if _is_vercel():
        task = get_task_history(task_id, user["uid"])
        metadata = payload.get("review") if isinstance(payload, dict) else None
    else:
        with _tasks_lock:
            task = _tasks.get(task_id)
            if task is not None and task.get("owner_uid") != user["uid"]:
                task = None
        if task is None:
            task = get_task_history(task_id, user["uid"])
        metadata = _load_review_metadata(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Tâche inconnue.")
    if task.get("status") != "review" or not isinstance(metadata, dict):
        if task.get("status") == "review":
            error = "La vidéo source n’est plus disponible. Relancez la création du Short."
            if _is_vercel():
                _fail_cloud_review(task_id, payload, error)
            else:
                _fail_review_task(task_id, error)
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

    render_options = {
        field: value
        for field, value in {
            "aspect_ratio": request.aspect_ratio,
            "subtitles": request.subtitles,
            "subtitle_color": request.subtitle_color,
            "subtitle_size": request.subtitle_size,
            "subtitle_position": request.subtitle_position,
            "subtitle_font": request.subtitle_font,
        }.items()
        if value is not None
    }

    if _is_vercel():
        if not isinstance(payload, dict) or not payload.get("source_blob_url"):
            raise HTTPException(status_code=410, detail="La vidéo source n’est plus disponible.")
        payload["job_kind"] = "render"
        payload["selection_start"] = start_time
        update_task_history(
            task_id,
            {
                "status": "queued",
                "progress": 60,
                "stage": "En attente du montage",
                **render_options,
            },
        )
        set_task_job_status(task_id, payload, "queued")
        return {"task_id": task_id}

    work_dir = TEMP_DIR / task_id
    source_name = metadata.get("source_name")
    if not isinstance(source_name, str) or Path(source_name).name != source_name:
        raise HTTPException(status_code=410, detail="La vidéo source n’est plus disponible.")
    source = work_dir / source_name
    if not source.is_file() or source.resolve().parent != work_dir.resolve():
        raise HTTPException(status_code=410, detail="La vidéo source n’est plus disponible.")

    with _tasks_lock:
        task = _tasks.get(task_id)
        if task is None or task.get("owner_uid") != user["uid"]:
            raise HTTPException(status_code=404, detail="Tâche inconnue.")
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
            **render_options,
        )
    metadata["selection_start"] = start_time
    review_path = work_dir / "review.json"
    try:
        review_path.write_text(json.dumps(metadata), encoding="utf-8")
        update_task_history(
            task_id,
            {
                "status": "processing",
                "progress": 65,
                "stage": "Montage FFmpeg",
                **render_options,
            },
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
    payload = get_task_payload(task_id) if _is_vercel() else None
    if history_entry is not None and _is_vercel() and isinstance(payload, dict):
        try:
            _delete_blob(payload.get("source_blob_url"))
            _delete_blob(payload.get("output_blob_url"))
        except Exception as exc:
            logger.exception("Impossible de supprimer les médias de la tâche %s.", task_id)
            raise HTTPException(status_code=502, detail="Impossible de supprimer les fichiers vidéo.") from exc
    deleted = delete_task_history(task_id, _user["uid"])
    if not _is_vercel():
        with _tasks_lock:
            if task_id in _tasks and _tasks[task_id].get("owner_uid") == _user["uid"]:
                review_was_pending = _tasks[task_id].get("status") == "review"
                _tasks.pop(task_id, None)
    if deleted and history_entry is not None and history_entry["status"] != "completed":
        settle_credits(task_id, succeeded=False)
    if deleted and review_was_pending and not _is_vercel():
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

    if _is_vercel():
        payload = get_task_payload(task_id)
        blob_url = payload.get("output_blob_url") if isinstance(payload, dict) else None
        if not isinstance(blob_url, str):
            raise HTTPException(status_code=404, detail="Fichier vidéo introuvable.")
        from vercel.blob import BlobClient

        video_path = TEMP_DIR / f"download-{task_id}-{uuid.uuid4().hex}.mp4"
        try:
            with BlobClient() as blob_client:
                blob_client.download_file(
                    blob_url,
                    video_path,
                    overwrite=True,
                    create_parents=True,
                )
        except Exception as exc:
            logger.exception("Impossible de récupérer le Short privé %s.", task_id)
            raise HTTPException(status_code=502, detail="Impossible de charger le Short.") from exc
        return FileResponse(
            video_path,
            media_type="video/mp4",
            filename=f"gemclip-{task_id}.mp4",
            headers={"Cache-Control": "private, no-store"},
            background=BackgroundTask(lambda: video_path.unlink(missing_ok=True)),
        )

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
    if _is_vercel():
        history_entry = get_task_history(task_id, _user["uid"])
        if history_entry is None:
            raise HTTPException(status_code=404, detail="Tâche inconnue.")
        if history_entry["status"] == "review":
            payload = get_task_payload(task_id)
            metadata = payload.get("review") if isinstance(payload, dict) else None
            if isinstance(metadata, dict):
                history_entry.update(_public_review_metadata(metadata))
            else:
                error = "La sélection de cette tâche a expiré."
                _fail_cloud_review(task_id, payload, error)
                raise HTTPException(status_code=410, detail=error)
        return history_entry

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
        if __package__:
            from backend.services.ai_analyzer import analyze_transcript
            from backend.services.downloader import download_video
            from backend.services.transcriber import transcribe
        else:
            from services.ai_analyzer import analyze_transcript
            from services.downloader import download_video
            from services.transcriber import transcribe

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


def _fail_cloud_review(
    task_id: str,
    payload: dict[str, Any] | None,
    error: str,
) -> None:
    try:
        source_url = payload.get("source_blob_url") if isinstance(payload, dict) else None
        _delete_blob(source_url)
    except Exception as exc:
        logger.exception("Impossible de supprimer la source indisponible de %s.", task_id)
        raise HTTPException(status_code=502, detail="Impossible de nettoyer la vidéo source.") from exc
    release_task_storage(task_id)
    update_task_history(
        task_id,
        {"status": "failed", "stage": "Sélection expirée", "error": error},
    )
    if isinstance(payload, dict):
        payload.update(job_kind=None, source_blob_url=None, review=None)
        set_task_job_status(task_id, payload, "idle")
    settle_credits(task_id, succeeded=False)


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
        if __package__:
            from backend.services.ai_analyzer import ClipSelection
            from backend.services.subtitle_gen import generate_ass
            from backend.services.transcriber import Transcript, Word
            from backend.services.video_processor import process_video
        else:
            from services.ai_analyzer import ClipSelection
            from services.subtitle_gen import generate_ass
            from services.transcriber import Transcript, Word
            from services.video_processor import process_video

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
