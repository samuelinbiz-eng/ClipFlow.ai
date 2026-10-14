from __future__ import annotations

import json
import logging
import mimetypes
import os
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from backend.services.ai_analyzer import ClipSelection
from backend.services.downloader import download_video
from backend.services.subtitle_gen import generate_ass
from backend.services.transcriber import Transcript, Word, transcribe
from backend.services.video_processor import process_video

logger = logging.getLogger("gemclip.worker")
MAX_UPLOAD_BYTES = 250 * 1024 * 1024
MAX_OUTPUT_BYTES = 100 * 1024 * 1024


def _settings() -> tuple[str, str]:
    api_url = os.getenv("GEMCLIP_API_URL", "").strip().rstrip("/")
    secret = os.getenv("GEMCLIP_WORKER_SECRET", "").strip()
    if not api_url.startswith(("https://", "http://")):
        raise RuntimeError("GEMCLIP_API_URL doit contenir l’URL HTTPS publique du backend.")
    if not secret:
        raise RuntimeError("Le secret GEMCLIP_WORKER_SECRET n’est pas configuré.")
    return api_url, secret


def _request(path: str, body: dict[str, Any] | None = None) -> Any:
    api_url, secret = _settings()
    request = urllib.request.Request(
        f"{api_url}/api/{path.lstrip('/')}",
        data=json.dumps(body).encode("utf-8") if body is not None else b"{}",
        headers={
            "Content-Type": "application/json",
            "X-GemClip-Worker-Secret": secret,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1200]
        raise RuntimeError(f"Le backend a répondu {exc.code} : {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Le backend GemClip est injoignable : {exc.reason}") from exc


def _progress(task_id: str, value: int, stage: str) -> None:
    _request(
        "worker/progress",
        {"task_id": task_id, "progress": max(1, min(99, value)), "stage": stage},
    )


def _progress_callback(task_id: str, start: int, span: int, stage: str):
    last_value = start - 1
    last_sent = 0.0

    def report(fraction: float) -> None:
        nonlocal last_value, last_sent
        value = start + round(max(0.0, min(1.0, fraction)) * span)
        now = time.monotonic()
        if value > last_value and (
            last_value < start
            or value >= last_value + 2
            or value >= start + span
            or now - last_sent >= 5
        ):
            _progress(task_id, value, stage)
            last_value = value
            last_sent = now

    return report


def _upload(path: Path, pathname: str) -> dict[str, Any]:
    from vercel.blob import BlobClient

    with BlobClient() as blob_client:
        blob = blob_client.upload_file(
            str(path),
            pathname,
            access="private",
            content_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream",
            add_random_suffix=False,
            overwrite=True,
        )
    return {"url": blob.url, "pathname": blob.pathname}


def _download(url: str, destination: Path) -> None:
    from vercel.blob import BlobClient

    destination.parent.mkdir(parents=True, exist_ok=True)
    with BlobClient() as blob_client:
        blob_client.download_file(
            url,
            destination,
            overwrite=True,
            create_parents=True,
        )


def _probe_duration(path: Path) -> float:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise RuntimeError("ffprobe est introuvable. Installez FFmpeg et ajoutez-le au PATH.")
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


def _analyze(task: dict[str, Any], work_dir: Path) -> None:
    task_id = str(task["task_id"])
    payload = task["payload"]
    options = task
    _progress(task_id, 2, "Préparation vidéo")

    source_url: str | None = None
    if payload.get("source_kind") == "upload":
        source_url = str(payload["source_blob_url"])
        source = work_dir / Path(str(payload["source_filename"])).name
        _download(source_url, source)
    elif payload.get("source_kind") == "youtube":
        source = download_video(
            str(payload["youtube_url"]),
            work_dir,
            _progress_callback(task_id, 2, 8, "Téléchargement vidéo"),
            max_height=int(options["resolution"]),
        )
    else:
        raise RuntimeError("Type de vidéo source non pris en charge.")

    if source.stat().st_size > MAX_UPLOAD_BYTES:
        raise RuntimeError("La vidéo source dépasse la limite de stockage gratuite de 250 Mo.")
    duration = _probe_duration(source)
    _progress(task_id, 12, "Transcription Whisper")
    transcript = transcribe(
        source,
        _progress_callback(task_id, 12, 45, "Transcription Whisper"),
        model_name=os.getenv("WHISPER_MODEL", "tiny"),
    )
    if len(transcript.words) > 30000:
        raise RuntimeError("La transcription dépasse la limite d’analyse de 30 000 mots.")
    analysis = _request(
        "worker/analyze",
        {
            "words": [
                {"start": word.start, "end": word.end, "text": word.text}
                for word in transcript.words
            ],
            "duration": duration,
            "target_duration": int(options["duration_seconds"]),
        },
    )
    clip_duration = min(float(options["duration_seconds"]), duration)
    selected_start = float(analysis["start_time"])
    selected_end = float(analysis["end_time"])
    start_time = max(
        0.0,
        min(selected_start + ((selected_end - selected_start) - clip_duration) / 2, duration - clip_duration),
    )

    if source_url is None:
        _progress(task_id, 58, "Stockage privé de la vidéo source")
        uploaded = _upload(source, f"sources/{task_id}/source{source.suffix.lower()}")
        source_url = str(uploaded["url"])
    _progress(task_id, 60, "Passage sélectionné")
    _request(
        "worker/complete",
        {
            "task_id": task_id,
            "status": "review",
            "source_url": source_url,
            "source_bytes": source.stat().st_size,
            "source_duration": duration,
            "clip_duration": clip_duration,
            "selection_start": start_time,
            "titre": str(analysis["titre"]),
            "explication": str(analysis["explication"]),
            "words": [
                {"start": word.start, "end": word.end, "text": word.text}
                for word in transcript.words
            ],
        },
    )


def _render(task: dict[str, Any], work_dir: Path) -> None:
    task_id = str(task["task_id"])
    payload = task["payload"]
    review = payload.get("review")
    source_url = payload.get("source_blob_url")
    if not isinstance(review, dict) or not isinstance(source_url, str):
        raise RuntimeError("Les données de sélection ou la vidéo source sont absentes.")

    source = work_dir / "source.mp4"
    _progress(task_id, 62, "Téléchargement privé de la vidéo source")
    _download(source_url, source)
    transcript = Transcript(
        words=[
            Word(start=float(word["start"]), end=float(word["end"]), text=str(word["text"]))
            for word in review["words"]
        ],
        text="",
    )
    start_time = float(payload["selection_start"])
    duration = float(review["clip_duration"])
    selection = ClipSelection(
        start_time=start_time,
        end_time=start_time + duration,
        titre=str(review["titre"]),
        explication=str(review["explication"]),
    )
    subtitles = None
    if task["subtitles"]:
        subtitles = generate_ass(
            transcript,
            selection,
            work_dir / "captions.ass",
            color=str(task["subtitle_color"]),
            size=str(task["subtitle_size"]),
            position=str(task["subtitle_position"]),
            font=str(task["subtitle_font"]),
        )

    output = work_dir / "clip.mp4"
    process_video(
        source,
        subtitles,
        output,
        selection,
        float(review["source_duration"]),
        _progress_callback(task_id, 65, 30, "Montage vidéo"),
        aspect_ratio=str(task["aspect_ratio"]),
        resolution=int(task["resolution"]),
    )
    output_bytes = output.stat().st_size
    if output_bytes > MAX_OUTPUT_BYTES:
        raise RuntimeError("Le Short dépasse la limite de stockage gratuite de 100 Mo.")
    _progress(task_id, 97, "Stockage privé du Short")
    uploaded = _upload(output, f"outputs/{task_id}/clip.mp4")
    _request(
        "worker/complete",
        {
            "task_id": task_id,
            "status": "completed",
            "output_url": str(uploaded["url"]),
            "output_bytes": output_bytes,
        },
    )


def _process(task: dict[str, Any]) -> None:
    task_id = str(task["task_id"])
    uuid.UUID(task_id)
    with tempfile.TemporaryDirectory(prefix=f"gemclip-{task_id}-") as directory:
        work_dir = Path(directory)
        if task["payload"].get("job_kind") == "analyze":
            _analyze(task, work_dir)
        elif task["payload"].get("job_kind") == "render":
            _render(task, work_dir)
        else:
            raise RuntimeError("Type de tâche vidéo inconnu.")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    _settings()
    while True:
        task = _request("worker/claim")
        if task is None:
            _request("worker/cleanup")
            return
        task_id = str(task["task_id"])
        try:
            logger.info("Traitement de la tâche %s (%s).", task_id, task["payload"].get("job_kind"))
            _process(task)
        except Exception as exc:
            logger.exception("Échec du traitement de la tâche %s.", task_id)
            try:
                _request(
                    "worker/complete",
                    {
                        "task_id": task_id,
                        "status": "failed",
                        "error": str(exc)[:1200] or "Le traitement vidéo a échoué.",
                    },
                )
            except Exception:
                logger.exception("Impossible de signaler l’échec de la tâche %s.", task_id)


if __name__ == "__main__":
    main()
