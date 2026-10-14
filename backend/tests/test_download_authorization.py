from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.services.ai_analyzer import ClipSelection
from backend.services.transcriber import Transcript, Word


class DownloadAuthorizationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.storage = tempfile.TemporaryDirectory()
        cls.previous_storage = os.environ.get("MEDIA_STORAGE_PATH")
        os.environ["MEDIA_STORAGE_PATH"] = cls.storage.name

        from backend import main
        from backend.services.auth import current_user

        cls.main = main
        cls.auth_dependency = current_user
        cls.client = TestClient(main.app)
        main.app.dependency_overrides[cls.auth_dependency] = lambda: {"uid": "owner"}

    def setUp(self) -> None:
        self.auth_dependency = type(self).auth_dependency
        self.main.app.dependency_overrides[self.auth_dependency] = lambda: {"uid": "owner"}

    @classmethod
    def tearDownClass(cls) -> None:
        cls.main.app.dependency_overrides.pop(cls.auth_dependency, None)
        if cls.previous_storage is None:
            os.environ.pop("MEDIA_STORAGE_PATH", None)
        else:
            os.environ["MEDIA_STORAGE_PATH"] = cls.previous_storage
        cls.storage.cleanup()

    def test_completed_video_is_streamed_only_after_owner_lookup(self) -> None:
        task_id = str(uuid.uuid4())
        video_path = Path(self.storage.name) / "output" / task_id / "clip.mp4"
        video_path.parent.mkdir(parents=True)
        video_path.write_bytes(b"private video")

        with patch.object(
            self.main,
            "get_task_history",
            return_value={"status": "completed"},
        ) as get_history:
            response = self.client.get(f"/api/history/{task_id}/download")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"private video")
        self.assertEqual(response.headers["cache-control"], "private, no-store")
        get_history.assert_called_once_with(task_id, "owner")

    def test_video_is_not_available_to_another_user(self) -> None:
        task_id = str(uuid.uuid4())
        self.main.app.dependency_overrides[self.auth_dependency] = lambda: {"uid": "other"}

        with patch.object(self.main, "get_task_history", return_value=None):
            response = self.client.get(f"/api/history/{task_id}/download")

        self.assertEqual(response.status_code, 404)

    def test_video_download_requires_authentication(self) -> None:
        task_id = str(uuid.uuid4())
        user_override = self.main.app.dependency_overrides.pop(self.auth_dependency)
        try:
            response = self.client.get(f"/api/history/{task_id}/download")
        finally:
            self.main.app.dependency_overrides[self.auth_dependency] = user_override

        self.assertEqual(response.status_code, 401)

    def test_invalid_task_id_is_not_a_file_path(self) -> None:
        with self.assertRaises(HTTPException) as error:
            self.main.download_history_video("../secret", {"uid": "owner"})

        self.assertEqual(error.exception.status_code, 404)

    def test_review_range_can_be_rendered_by_its_owner(self) -> None:
        task_id = str(uuid.uuid4())
        work_dir = Path(self.storage.name) / "temp" / task_id
        work_dir.mkdir(parents=True)
        (work_dir / "source.mp4").write_bytes(b"source")
        (work_dir / "review.json").write_text(
            json.dumps(
                {
                    "source_name": "source.mp4",
                    "source_duration": 100,
                    "clip_duration": 30,
                    "selection_start": 10,
                    "titre": "Passage",
                    "explication": "Test",
                    "words": [],
                }
            ),
            encoding="utf-8",
        )
        task = {
            "task_id": task_id,
            "owner_uid": "owner",
            "status": "review",
            "subtitle_color": "yellow",
            "subtitle_size": "medium",
            "subtitle_position": "bottom",
            "subtitles": True,
            "aspect_ratio": "9:16",
            "resolution": 720,
        }
        self.main._tasks[task_id] = task
        try:
            with patch.object(self.main, "update_task_history"), patch.object(
                self.main, "_render_selected_clip"
            ) as render:
                response = self.client.post(
                    f"/api/clip/{task_id}/render",
                    json={"start_time": 25},
                )

            self.assertEqual(response.status_code, 202)
            self.assertEqual(task["status"], "processing")
            render.assert_called_once()
            self.assertEqual(render.call_args.args[-1], 25)
        finally:
            self.main._tasks.pop(task_id, None)
            shutil.rmtree(work_dir, ignore_errors=True)

    def test_review_range_cannot_exceed_source_duration(self) -> None:
        task_id = str(uuid.uuid4())
        work_dir = Path(self.storage.name) / "temp" / task_id
        work_dir.mkdir(parents=True)
        (work_dir / "source.mp4").write_bytes(b"source")
        (work_dir / "review.json").write_text(
            json.dumps(
                {
                    "source_name": "source.mp4",
                    "source_duration": 100,
                    "clip_duration": 30,
                    "selection_start": 10,
                    "titre": "Passage",
                    "explication": "Test",
                    "words": [],
                }
            ),
            encoding="utf-8",
        )
        self.main._tasks[task_id] = {
            "task_id": task_id,
            "owner_uid": "owner",
            "status": "review",
        }
        try:
            response = self.client.post(
                f"/api/clip/{task_id}/render",
                json={"start_time": 71},
            )
        finally:
            self.main._tasks.pop(task_id, None)
            shutil.rmtree(work_dir, ignore_errors=True)

        self.assertEqual(response.status_code, 422)

    def test_pipeline_preserves_source_and_ai_selection_for_review(self) -> None:
        task_id = str(uuid.uuid4())
        work_dir = Path(self.storage.name) / "temp" / task_id
        work_dir.mkdir(parents=True)
        source = work_dir / "source.mp4"
        source.write_bytes(b"source")
        task = {
            "task_id": task_id,
            "owner_uid": "owner",
            "status": "queued",
            "resolution": 720,
            "subtitles": True,
            "subtitle_color": "yellow",
            "subtitle_size": "medium",
            "subtitle_position": "bottom",
            "aspect_ratio": "9:16",
        }
        self.main._tasks[task_id] = task

        def update_task(updated_task_id: str, **values: object) -> None:
            self.assertEqual(updated_task_id, task_id)
            task.update(values)

        transcript = Transcript(
            words=[Word(start=22, end=23, text="Bonjour")],
            text="Bonjour",
        )
        selection = ClipSelection(
            start_time=20,
            end_time=65,
            titre="Passage intéressant",
            explication="Un extrait de test.",
        )
        try:
            with (
                patch.object(self.main, "_update", side_effect=update_task),
                patch(
                    "backend.services.transcriber.transcribe",
                    return_value=transcript,
                ),
                patch.object(self.main, "_probe_duration", return_value=100),
                patch(
                    "backend.services.ai_analyzer.analyze_transcript",
                    return_value=selection,
                ),
            ):
                self.main._run_pipeline(task_id, None, source, 45)

            review = json.loads((work_dir / "review.json").read_text(encoding="utf-8"))
            self.assertEqual(task["status"], "review")
            self.assertEqual(review["selection_start"], 20)
            self.assertEqual(review["clip_duration"], 45)
            self.assertEqual(review["words"][0]["text"], "Bonjour")
            self.assertTrue(source.is_file())
        finally:
            self.main._tasks.pop(task_id, None)
            shutil.rmtree(work_dir, ignore_errors=True)
