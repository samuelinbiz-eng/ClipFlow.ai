from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from faster_whisper import WhisperModel


@dataclass
class Word:
    start: float
    end: float
    text: str


@dataclass
class Transcript:
    words: list[Word]
    text: str


_model: WhisperModel | None = None


def transcribe(
    audio_path: Path,
    on_progress: Callable[[float], None],
    model_name: str = "tiny",
) -> Transcript:
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        _model = WhisperModel(model_name, device="cpu", compute_type="int8")

    segments, info = _model.transcribe(
        str(audio_path),
        word_timestamps=True,
        vad_filter=True,
    )
    words: list[Word] = []
    text_parts: list[str] = []
    duration = max(float(info.duration or 0), 1.0)
    for segment in segments:
        text_parts.append(segment.text.strip())
        if segment.words:
            for word in segment.words:
                words.append(
                    Word(
                        start=float(word.start),
                        end=float(word.end),
                        text=word.word,
                    )
                )
        on_progress(min(1.0, max(0.0, float(segment.end) / duration)))

    if not words:
        raise RuntimeError("Whisper n'a retourné aucun mot horodaté pour cette vidéo.")
    return Transcript(words=words, text=" ".join(part for part in text_parts if part))
