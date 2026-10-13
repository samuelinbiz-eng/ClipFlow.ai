from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable

import yt_dlp


ProgressCallback = Callable[[float], None]


def _cookie_file() -> str | None:
    project_root = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..")
    )
    candidates = (
        os.path.join(project_root, "cookies.txt"),
        os.path.join(os.path.expanduser("~"), "Downloads", "cookies.txt"),
    )
    return next((path for path in candidates if os.path.exists(path)), None)


def _ydl_options(options: dict) -> dict:
    ydl_options = {
        **options,
        "socket_timeout": 30,
        "retries": 3,
        "fragment_retries": 3,
        "extractor_retries": 2,
    }
    cookie_file = _cookie_file()
    if cookie_file:
        ydl_options["cookiefile"] = cookie_file
    return ydl_options


def _download_error(exc: yt_dlp.utils.DownloadError) -> RuntimeError:
    message = str(exc)
    lowered = message.lower()
    if "page needs to be reloaded" in lowered:
        return RuntimeError(
            "YouTube a refusé la lecture même après une nouvelle tentative. "
            "Réexportez cookies.txt depuis une session YouTube active et réessayez."
        )
    if any(term in lowered for term in ("cookie", "sign in", "not a bot", "authentication")):
        if _cookie_file():
            return RuntimeError(
                "YouTube a rejeté cookies.txt. Vérifiez que le fichier est valide "
                "et que votre session YouTube n'a pas expiré."
            )
        return RuntimeError(
            "YouTube demande une authentification. Placez un fichier cookies.txt "
            "à la racine du projet ou dans votre dossier Downloads, puis réessayez."
        )
    return RuntimeError(f"Échec du téléchargement YouTube : {message}")


def _run_ytdlp(options: dict, action: Callable[[Any], Any]) -> Any:
    current_options = options
    tried_reload_fallback = False
    tried_generic_format = options.get("format") == "best"
    for _ in range(3):
        try:
            with yt_dlp.YoutubeDL(current_options) as ydl:
                return action(ydl)
        except yt_dlp.utils.DownloadError as exc:
            message = str(exc).lower()
            if "page needs to be reloaded" in message and not tried_reload_fallback:
                extractor_args = current_options.get("extractor_args", {})
                youtube_args = extractor_args.get("youtube", {})
                current_options = {
                    **current_options,
                    "extractor_args": {
                        **extractor_args,
                        "youtube": {
                            **youtube_args,
                            "player_client": ["android_vr"],
                        },
                    },
                }
                tried_reload_fallback = True
                continue
            if "requested format is not available" in message and not tried_generic_format:
                current_options = {**current_options, "format": "best"}
                tried_generic_format = True
                continue
            raise _download_error(exc) from exc
    raise RuntimeError("yt-dlp a épuisé ses tentatives de téléchargement.")


def download_video(
    url: str,
    destination: Path,
    on_progress: ProgressCallback,
    max_height: int = 1080,
) -> Path:
    if max_height not in {720, 1080}:
        raise ValueError("La hauteur maximale doit être de 720p ou 1080p.")
    destination.mkdir(parents=True, exist_ok=True)
    height_limit = f"[height<={max_height}]"
    options = _ydl_options({
        "format": (
            f"bestvideo{height_limit}[ext=mp4]+bestaudio[ext=m4a]/"
            f"best{height_limit}[ext=mp4]/"
            f"bestvideo{height_limit}+bestaudio/best{height_limit}/best"
        ),
        "merge_output_format": "mp4",
        "outtmpl": str(destination / "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [_progress_hook(on_progress)],
    })
    def extract_video(ydl: Any) -> tuple[dict, Path]:
        info = ydl.extract_info(url, download=True)
        return info, Path(ydl.prepare_filename(info))

    _, filepath = _run_ytdlp(options, extract_video)
    if filepath.suffix.lower() != ".mp4":
        merged = filepath.with_suffix(".mp4")
        if merged.exists():
            filepath = merged
    if not filepath.exists():
        matches = list(destination.glob("source.*"))
        if not matches:
            raise RuntimeError("yt-dlp n'a créé aucun fichier vidéo.")
        filepath = matches[0]
    return filepath


def download_audio(url: str, destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    options = _ydl_options({
        "format": "bestaudio/best",
        "outtmpl": str(destination / "audio.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }
        ],
    })
    _run_ytdlp(options, lambda ydl: ydl.download([url]))
    audio_path = destination / "audio.mp3"
    if not audio_path.exists():
        raise RuntimeError(
            "yt-dlp n'a pas créé l'audio MP3. Vérifiez que FFmpeg est installé et accessible."
        )
    return audio_path


def _progress_hook(on_progress: ProgressCallback):
    def hook(data: dict) -> None:
        if data.get("status") == "downloading":
            total = data.get("total_bytes") or data.get("total_bytes_estimate")
            if total:
                on_progress(min(1.0, max(0.0, data.get("downloaded_bytes", 0) / total)))

    return hook
