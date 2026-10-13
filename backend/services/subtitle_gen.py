from __future__ import annotations

from pathlib import Path

from backend.services.ai_analyzer import ClipSelection
from backend.services.transcriber import Transcript, Word


def generate_ass(
    transcript: Transcript,
    selection: ClipSelection,
    output_path: Path,
) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    selected = [
        word
        for word in transcript.words
        if word.end > selection.start_time and word.start < selection.end_time
    ]
    events = []
    for index, word in enumerate(selected):
        group_start = max(0, index - 2)
        group = selected[group_start : group_start + 5]
        start = max(word.start, selection.start_time) - selection.start_time
        end = min(word.end, selection.end_time) - selection.start_time
        caption = " ".join(
            f"{{\\c&H00FFFF&\\b1}}{_escape_ass(item.text)}{{\\rDefault}}"
            if item is word
            else _escape_ass(item.text)
            for item in group
        )
        events.append(
            f"Dialogue: 0,{_timestamp(start)},{_timestamp(end)},Default,,0,0,0,,{caption}"
        )

    content = "\n".join(
        [
            "[Script Info]",
            "ScriptType: v4.00+",
            "WrapStyle: 2",
            "PlayResX: 1080",
            "PlayResY: 1920",
            "ScaledBorderAndShadow: yes",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
            "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
            "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
            "Style: Default,Arial,72,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,1,0,0,0,100,100,1,0,1,4,2,2,70,70,250,1",
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
            *events,
            "",
        ]
    )
    output_path.write_text(content, encoding="utf-8")
    return output_path


def _timestamp(seconds: float) -> str:
    centiseconds = max(0, round(seconds * 100))
    hours, remainder = divmod(centiseconds, 360000)
    minutes, remainder = divmod(remainder, 6000)
    whole_seconds, centiseconds = divmod(remainder, 100)
    return f"{hours}:{minutes:02}:{whole_seconds:02}.{centiseconds:02}"


def _escape_ass(text: str) -> str:
    return text.replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}")
