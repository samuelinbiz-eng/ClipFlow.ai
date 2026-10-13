from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import cv2

from backend.services.ai_analyzer import ClipSelection


@dataclass
class CropPoint:
    time: float
    x: int
    y: int


def process_video(
    source: Path,
    subtitles: Path | None,
    destination: Path,
    selection: ClipSelection,
    source_duration: float,
    on_progress: Callable[[float], None],
    aspect_ratio: str = "9:16",
    resolution: int = 1080,
) -> Path:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError(
            "FFmpeg est introuvable. Installez FFmpeg et ajoutez-le au PATH."
        )
    dimensions = {
        "9:16": (resolution, resolution * 16 // 9),
        "1:1": (resolution, resolution),
        "16:9": (resolution * 16 // 9, resolution),
    }
    if aspect_ratio not in dimensions or resolution not in {720, 1080}:
        raise ValueError("Format ou résolution vidéo non pris en charge.")
    output_width, output_height = dimensions[aspect_ratio]
    duration = selection.end_time - selection.start_time
    crop_width, crop_height, points = _auto_crop_points(
        source, selection.start_time, duration, output_width / output_height
    )
    crop_x = _coordinate_expression(points, "x")
    crop_y = _coordinate_expression(points, "y")
    filters = [
        f"crop={crop_width}:{crop_height}:{crop_x}:{crop_y}",
        f"scale={output_width}:{output_height}",
        "setsar=1",
    ]
    if subtitles is not None:
        escaped_subtitle_path = str(subtitles.resolve()).replace("\\", "/")
        escaped_subtitle_path = escaped_subtitle_path.replace(":", r"\:").replace("'", r"\'")
        filters.append(f"subtitles='{escaped_subtitle_path}'")
    filter_value = ",".join(filters)
    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        str(selection.start_time),
        "-i",
        str(source),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-t",
        str(duration),
        "-vf",
        filter_value,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-progress",
        "pipe:1",
        "-nostats",
        str(destination),
    ]
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        assert process.stdout is not None
        diagnostics: list[str] = []
        for line in process.stdout:
            if line.startswith("out_time_ms="):
                try:
                    elapsed = int(line.partition("=")[2]) / 1_000_000
                    on_progress(min(1.0, max(0.0, elapsed / duration)))
                except ValueError:
                    continue
            elif line.strip() and not line.startswith(
                ("frame=", "fps=", "stream_", "bitrate=", "total_size=", "out_time_", "out_time=", "dup_frames=", "drop_frames=", "speed=", "progress=")
            ):
                diagnostics.append(line.strip())
                diagnostics = diagnostics[-30:]
        return_code = process.wait()
    except OSError as exc:
        raise RuntimeError(f"Impossible de lancer FFmpeg : {exc}") from exc

    if return_code != 0:
        detail = "\n".join(diagnostics)[-1200:]
        if "No such filter: 'subtitles'" in detail or "libass" in detail.lower():
            raise RuntimeError(
                "Cette installation de FFmpeg ne prend pas en charge le filtre subtitles/libass."
            )
        raise RuntimeError(f"FFmpeg a échoué (code {return_code}) : {detail}")
    if not destination.exists() or destination.stat().st_size == 0:
        raise RuntimeError("FFmpeg s'est terminé sans produire de vidéo.")
    on_progress(1.0)
    return destination


def _auto_crop_points(
    source: Path, start_time: float, duration: float, target_ratio: float = 9 / 16
) -> tuple[int, int, list[CropPoint]]:
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise RuntimeError("Impossible de lire la vidéo pour calculer le recadrage.")
    try:
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if width <= 0 or height <= 0:
            raise RuntimeError("Impossible de déterminer les dimensions de la vidéo.")

        if width / height >= target_ratio:
            crop_height = height
            crop_width = max(1, round(height * target_ratio))
        else:
            crop_width = width
            crop_height = max(1, round(width / target_ratio))

        center_x = (width - crop_width) // 2
        center_y = (height - crop_height) // 2
        cascade = cv2.CascadeClassifier(
            str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml")
        )
        if cascade.empty():
            raise RuntimeError("Le détecteur de visages OpenCV est introuvable.")

        scale = min(1.0, 640 / width)
        detected_points: list[CropPoint] = []
        offsets = [float(second) for second in range(int(duration) + 1)]
        if not offsets or offsets[-1] < duration:
            offsets.append(duration)
        for offset in offsets:
            capture.set(cv2.CAP_PROP_POS_MSEC, (start_time + offset) * 1000)
            success, frame = capture.read()
            if not success:
                continue
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            if scale < 1:
                gray = cv2.resize(
                    gray,
                    (max(1, round(width * scale)), max(1, round(height * scale))),
                )
            faces = cascade.detectMultiScale(
                gray,
                scaleFactor=1.1,
                minNeighbors=5,
                minSize=(24, 24),
            )
            if len(faces) == 0:
                continue
            face_x, face_y, face_width, face_height = max(
                faces, key=lambda face: int(face[2]) * int(face[3])
            )
            subject_x = round((face_x + face_width / 2) / scale)
            subject_y = round((face_y + face_height / 2) / scale)
            crop_x = (
                min(width - crop_width, max(0, subject_x - crop_width // 2))
                if width > crop_width
                else 0
            )
            crop_y = (
                min(
                    height - crop_height,
                    max(0, subject_y - round(crop_height * 0.35)),
                )
                if height > crop_height
                else 0
            )
            detected_points.append(CropPoint(offset, crop_x, crop_y))
    finally:
        capture.release()

    if not detected_points:
        return crop_width, crop_height, [CropPoint(0, center_x, center_y)]

    points = [CropPoint(0, detected_points[0].x, detected_points[0].y)]
    points.extend(point for point in detected_points if 0 < point.time < duration)
    points.append(CropPoint(duration, detected_points[-1].x, detected_points[-1].y))
    return crop_width, crop_height, points


def _coordinate_expression(points: list[CropPoint], coordinate: str) -> str:
    if len(points) == 1:
        return str(getattr(points[0], coordinate))

    expression = str(getattr(points[-1], coordinate))
    for left, right in reversed(list(zip(points, points[1:]))):
        left_value = getattr(left, coordinate)
        right_value = getattr(right, coordinate)
        elapsed = right.time - left.time
        if elapsed <= 0:
            continue
        interpolated = (
            f"({left_value}+({right_value}-{left_value})"
            f"*(t-{left.time:.3f})/{elapsed:.3f})"
        )
        expression = (
            f"if(lt(t\\,{right.time:.3f})\\,{interpolated}\\,{expression})"
        )
    return expression
