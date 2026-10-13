from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.services.ai_analyzer import ClipSelection
from backend.services.subtitle_gen import generate_ass
from backend.services.transcriber import Transcript, Word


class AnimatedSubtitleTests(unittest.TestCase):
    def test_active_word_pops_in_and_dialogue_fades(self) -> None:
        transcript = Transcript(
            words=[
                Word(start=1.0, end=1.4, text="Bonjour"),
                Word(start=1.4, end=1.8, text="le"),
                Word(start=1.8, end=2.2, text="monde"),
            ],
            text="Bonjour le monde",
        )
        selection = ClipSelection(
            start_time=0.0,
            end_time=30.0,
            titre="Test",
            explication="Test d’animation",
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            subtitle_path = generate_ass(
                transcript,
                selection,
                Path(temp_dir) / "subtitles.ass",
            )
            content = subtitle_path.read_text(encoding="utf-8")

        self.assertIn(r"{\fad(100,0)}", content)
        self.assertIn(r"\fscx82\fscy82\t(0,120,\fscx100\fscy100)", content)
        self.assertIn("Bonjour", content)
        self.assertIn("le", content)
        self.assertIn("monde", content)

    def test_custom_font_size_and_color_are_written_to_ass_style(self) -> None:
        transcript = Transcript(words=[], text="")
        selection = ClipSelection(
            start_time=0.0,
            end_time=30.0,
            titre="Test",
            explication="Test de personnalisation",
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            subtitle_path = generate_ass(
                transcript,
                selection,
                Path(temp_dir) / "custom-style.ass",
                color="#12ABEF",
                size="xlarge",
                font="Noto Sans",
            )
            content = subtitle_path.read_text(encoding="utf-8")

        self.assertIn("Style: Default,Noto Sans,110,&H00EFAB12,", content)

    def test_invalid_custom_color_is_rejected(self) -> None:
        transcript = Transcript(words=[], text="")
        selection = ClipSelection(
            start_time=0.0,
            end_time=30.0,
            titre="Test",
            explication="Test couleur invalide",
        )
        with tempfile.TemporaryDirectory() as temp_dir, self.assertRaises(ValueError):
            generate_ass(
                transcript,
                selection,
                Path(temp_dir) / "invalid-color.ass",
                color="#12AB",
            )


if __name__ == "__main__":
    unittest.main()
