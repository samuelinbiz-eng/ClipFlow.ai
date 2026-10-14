from __future__ import annotations

import re
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.services.ai_analyzer import ClipSelection
    from backend.services.transcriber import Transcript

SUBTITLE_STYLES = {
    "white": "&H00FFFFFF",
    "yellow": "&H0000FFFF",
    "cyan": "&H00FFD421",
    "pink": "&H00D65AFF",
}
FONT_FAMILIES = {"Arial", "DejaVu Sans", "Liberation Sans", "Noto Sans"}
FONT_SIZES = {
    "xsmall": 40,
    "small": 56,
    "medium": 72,
    "large": 90,
    "xlarge": 110,
}
POSITIONS = {"bottom": (2, 180), "center": (5, 0), "top": (8, 180)}


def generate_ass(
    transcript: Transcript,
    selection: ClipSelection,
    output_path: Path,
    color: str = "#FFD400",
    size: str = "medium",
    position: str = "bottom",
    font: str = "Arial",
) -> Path:
    if size not in FONT_SIZES or position not in POSITIONS or font not in FONT_FAMILIES:
        raise ValueError("Style de sous-titres non pris en charge.")
    subtitle_color = _ass_color(color)
    alignment, vertical_margin = POSITIONS[position]
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
            f"{{\\c{subtitle_color}&\\b1\\fscx82\\fscy82\\t(0,120,\\fscx100\\fscy100)}}"
            f"{_escape_ass(item.text)}{{\\rDefault}}"
            if item is word
            else _escape_ass(item.text)
            for item in group
        )
        events.append(
            f"Dialogue: 0,{_timestamp(start)},{_timestamp(end)},Default,,0,0,0,,"
            f"{{\\fad(100,0)}}{caption}"
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
            f"Style: Default,{font},{FONT_SIZES[size]},{subtitle_color},&H0000FFFF,&H00000000,&H80000000,1,0,0,0,100,100,1,0,1,4,2,{alignment},70,70,{vertical_margin},1",
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
            *events,
            "",
        ]
    )
    output_path.write_text(content, encoding="utf-8")
    return output_path


def _ass_color(color: str) -> str:
    if color in SUBTITLE_STYLES:
        return SUBTITLE_STYLES[color]
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise ValueError("La couleur des sous-titres doit être un code hexadécimal valide.")
    red, green, blue = (color[index:index + 2] for index in (1, 3, 5))
    return f"&H00{blue}{green}{red}".upper()


def validate_subtitle_color(color: str) -> str:
    _ass_color(color)
    return color


def _timestamp(seconds: float) -> str:
    centiseconds = max(0, round(seconds * 100))
    hours, remainder = divmod(centiseconds, 360000)
    minutes, remainder = divmod(remainder, 6000)
    whole_seconds, centiseconds = divmod(remainder, 100)
    return f"{hours}:{minutes:02}:{whole_seconds:02}.{centiseconds:02}"


def _escape_ass(text: str) -> str:
    return text.replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}")
