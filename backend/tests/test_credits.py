from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from backend.services import credits


class CreditBalanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.storage = tempfile.TemporaryDirectory()
        self.previous_path = os.environ.get("CREDITS_DATABASE_PATH")
        self.previous_initialized = credits._initialized_database
        os.environ["CREDITS_DATABASE_PATH"] = str(
            Path(self.storage.name) / "credits.sqlite3"
        )
        credits._initialized_database = None

    def tearDown(self) -> None:
        credits._initialized_database = self.previous_initialized
        if self.previous_path is None:
            os.environ.pop("CREDITS_DATABASE_PATH", None)
        else:
            os.environ["CREDITS_DATABASE_PATH"] = self.previous_path
        self.storage.cleanup()

    def test_balance_uses_stored_subscription_without_a_paypal_request(self) -> None:
        with closing(credits._connect()) as connection:
            connection.execute(
                """
                INSERT INTO user_subscriptions
                    (user_id, paypal_subscription_id, status, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                ("plus-user", "subscription-id", "ACTIVE", "2026-10-13T00:00:00+00:00"),
            )

        with patch.object(
            credits,
            "_sync_subscription",
            side_effect=AssertionError("credit balance must not contact PayPal"),
        ):
            balance = credits.credit_balance("plus-user")

        self.assertEqual(balance["plan"], "plus")
        self.assertEqual(balance["daily_allowance"], credits.PLUS_DAILY_CREDITS)
        self.assertEqual(balance["remaining"], credits.PLUS_DAILY_CREDITS)

    def test_font_setting_is_saved_in_task_history(self) -> None:
        credits.record_task(
            task_id="font-task",
            user_id="user",
            source="video.mp4",
            duration_seconds=30,
            resolution=720,
            aspect_ratio="9:16",
            subtitles=True,
            subtitle_color="#12ABEF",
            subtitle_size="xlarge",
            subtitle_position="bottom",
            subtitle_font="Noto Sans",
            credit_cost=1,
        )

        record = credits.get_task_history("font-task", "user")
        self.assertIsNotNone(record)
        self.assertEqual(record["subtitle_font"], "Noto Sans")
        self.assertEqual(record["subtitle_color"], "#12ABEF")

    def test_existing_history_database_gets_default_font_column(self) -> None:
        database_path = Path(os.environ["CREDITS_DATABASE_PATH"])
        with closing(sqlite3.connect(database_path)) as connection:
            connection.execute(
                """
                CREATE TABLE task_history (
                    task_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL DEFAULT 0,
                    stage TEXT NOT NULL,
                    error TEXT,
                    video_url TEXT,
                    title TEXT,
                    explanation TEXT,
                    duration_seconds INTEGER NOT NULL,
                    resolution INTEGER NOT NULL,
                    aspect_ratio TEXT NOT NULL,
                    subtitles INTEGER NOT NULL,
                    subtitle_color TEXT NOT NULL,
                    subtitle_size TEXT NOT NULL,
                    subtitle_position TEXT NOT NULL,
                    credit_cost INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                INSERT INTO task_history (
                    task_id, user_id, source, status, stage, duration_seconds,
                    resolution, aspect_ratio, subtitles, subtitle_color, subtitle_size,
                    subtitle_position, credit_cost, created_at, updated_at
                ) VALUES ('old-task', 'user', 'old.mp4', 'completed', 'Terminé', 30,
                    720, '9:16', 1, 'yellow', 'medium', 'bottom', 1, 'now', 'now')
                """
            )
            connection.commit()
        credits._initialize()

        record = credits.get_task_history("old-task", "user")
        self.assertIsNotNone(record)
        self.assertEqual(record["subtitle_font"], "Arial")

    def test_upload_completion_is_idempotent_for_the_same_blob(self) -> None:
        upload_id = "upload-id"
        pathname = "uploads/user/upload-id.mp4"
        blob_url = "https://store.private.blob.vercel-storage.com/uploads/user/upload-id.mp4"
        credits.reserve_upload_storage("user", upload_id, pathname)

        credits.complete_upload_storage(upload_id, pathname, blob_url, 1024)
        credits.complete_upload_storage(upload_id, pathname, blob_url, 1024)

        record = credits.get_media_upload(upload_id, "user")
        self.assertIsNotNone(record)
        self.assertEqual(record["status"], "uploaded")
        self.assertEqual(record["actual_bytes"], 1024)

    def test_expired_upload_reservations_are_not_released_before_blob_deletion(self) -> None:
        upload_id = "upload-id"
        pathname = "uploads/user/upload-id.mp4"
        credits.reserve_upload_storage("user", upload_id, pathname)
        with closing(credits._connect()) as connection:
            connection.execute(
                "UPDATE media_uploads SET created_at = ? WHERE upload_id = ?",
                ("2000-01-01T00:00:00+00:00", upload_id),
            )

        expired = credits.expire_upload_reservations("2020-01-01T00:00:00+00:00")
        record = credits.get_media_upload(upload_id, "user")

        self.assertEqual([item["upload_id"] for item in expired], [upload_id])
        self.assertIsNotNone(record)
        self.assertEqual(record["status"], "reserved")
        credits.release_task_storage(upload_id)
        released = credits.get_media_upload(upload_id, "user")
        self.assertIsNotNone(released)
        self.assertEqual(released["status"], "deleted")


if __name__ == "__main__":
    unittest.main()
