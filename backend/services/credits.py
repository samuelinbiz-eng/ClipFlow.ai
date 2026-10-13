from __future__ import annotations

import os
import sqlite3
import threading
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.services.paypal import verify_subscription

BASE_DIR = Path(__file__).resolve().parents[1]
FREE_DAILY_CREDITS = 10
PLUS_DAILY_CREDITS = 100
ALLOWED_DURATIONS = {30, 45, 55}
ALLOWED_RESOLUTIONS = {720, 1080}
_database_lock = threading.Lock()
_initialized_database: Path | None = None


class InsufficientCreditsError(ValueError):
    def __init__(self, required: int, remaining: int) -> None:
        self.required = required
        self.remaining = remaining
        super().__init__(
            f"Il vous faut {required} jeton(s), mais il ne vous en reste que {remaining} aujourd’hui."
        )


def _database_path() -> Path:
    return Path(
        os.getenv("CREDITS_DATABASE_PATH", str(BASE_DIR / "data" / "credits.sqlite3"))
    ).resolve()


def _initialize() -> None:
    global _initialized_database
    database_path = _database_path()
    with _database_lock:
        if _initialized_database == database_path:
            return
        database_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(
            sqlite3.connect(database_path, timeout=15, isolation_level=None)
        ) as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS user_subscriptions (
                    user_id TEXT PRIMARY KEY,
                    paypal_subscription_id TEXT NOT NULL UNIQUE,
                    status TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS credit_reservations (
                    task_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    credit_date TEXT NOT NULL,
                    amount INTEGER NOT NULL CHECK (amount > 0),
                    status TEXT NOT NULL CHECK (status IN ('reserved', 'completed', 'refunded')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS credits_daily_user_idx
                    ON credit_reservations(user_id, credit_date, status);
                CREATE TABLE IF NOT EXISTS task_history (
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
                    subtitle_font TEXT NOT NULL DEFAULT 'Arial',
                    credit_cost INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS task_history_user_date_idx
                    ON task_history(user_id, created_at DESC);
                """
            )
            task_history_columns = {
                row[1]
                for row in connection.execute("PRAGMA table_info(task_history)")
            }
            if "subtitle_font" not in task_history_columns:
                connection.execute(
                    "ALTER TABLE task_history ADD COLUMN subtitle_font TEXT NOT NULL DEFAULT 'Arial'"
                )
            connection.execute(
                """
                UPDATE credit_reservations
                SET status = 'refunded', updated_at = ?
                WHERE status = 'reserved'
                """,
                (datetime.now(timezone.utc).isoformat(),),
            )
            connection.execute(
                """
                UPDATE task_history
                SET status = 'failed', stage = 'Échec · serveur redémarré',
                    error = 'Le serveur a redémarré pendant le traitement.',
                    updated_at = ?
                WHERE status IN ('queued', 'processing')
                """,
                (datetime.now(timezone.utc).isoformat(),),
            )
        _initialized_database = database_path


def _connect() -> sqlite3.Connection:
    _initialize()
    connection = sqlite3.connect(_database_path(), timeout=15, isolation_level=None)
    connection.row_factory = sqlite3.Row
    return connection


def short_cost(duration_seconds: int, resolution: int) -> int:
    if duration_seconds not in ALLOWED_DURATIONS:
        raise ValueError("La durée doit être de 30, 45 ou 55 secondes.")
    if resolution not in ALLOWED_RESOLUTIONS:
        raise ValueError("La qualité doit être de 720p ou 1080p.")
    return (duration_seconds + 29) // 30 + (1 if resolution == 1080 else 0)


def _utc_day() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _sync_subscription(user_id: str) -> bool:
    connection = _connect()
    try:
        row = connection.execute(
            "SELECT paypal_subscription_id FROM user_subscriptions WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    finally:
        connection.close()

    if row is None:
        return False

    subscription_id = str(row["paypal_subscription_id"])
    try:
        verified = verify_subscription(subscription_id, expected_user_id=user_id)
    except ValueError:
        with closing(_connect()) as connection:
            connection.execute(
                """
                UPDATE user_subscriptions
                SET status = 'INACTIVE', updated_at = ?
                WHERE user_id = ? AND paypal_subscription_id = ?
                """,
                (datetime.now(timezone.utc).isoformat(), user_id, subscription_id),
            )
        return False

    with closing(_connect()) as connection:
        connection.execute(
            """
            UPDATE user_subscriptions
            SET status = ?, updated_at = ?
            WHERE user_id = ? AND paypal_subscription_id = ?
            """,
            (
                verified["status"],
                datetime.now(timezone.utc).isoformat(),
                user_id,
                subscription_id,
            ),
        )
    return verified["status"] == "ACTIVE"


def activate_subscription(user_id: str, subscription_id: str) -> dict[str, Any]:
    verified = verify_subscription(subscription_id, expected_user_id=user_id)
    now = datetime.now(timezone.utc).isoformat()
    try:
        with closing(_connect()) as connection:
            connection.execute(
                """
                INSERT INTO user_subscriptions (user_id, paypal_subscription_id, status, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    paypal_subscription_id = excluded.paypal_subscription_id,
                    status = excluded.status,
                    updated_at = excluded.updated_at
                """,
                (user_id, verified["subscription_id"], verified["status"], now),
            )
    except sqlite3.IntegrityError as exc:
        raise ValueError("Cet abonnement PayPal est déjà associé à un autre compte.") from exc
    return verified


def credit_balance(
    user_id: str,
    subscription_active: bool | None = None,
) -> dict[str, Any]:
    is_plus = (
        _stored_subscription_active(user_id)
        if subscription_active is None
        else subscription_active
    )
    allowance = PLUS_DAILY_CREDITS if is_plus else FREE_DAILY_CREDITS
    today = _utc_day()
    with closing(_connect()) as connection:
        spent = connection.execute(
            """
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM credit_reservations
            WHERE user_id = ? AND credit_date = ? AND status != 'refunded'
            """,
            (user_id, today),
        ).fetchone()["total"]

    return {
        "plan": "plus" if is_plus else "free",
        "daily_allowance": allowance,
        "spent_today": int(spent),
        "remaining": max(0, allowance - int(spent)),
        "resets_at": "00:00 UTC",
    }


def _stored_subscription_active(user_id: str) -> bool:
    with closing(_connect()) as connection:
        row = connection.execute(
            "SELECT status FROM user_subscriptions WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    return row is not None and row["status"] == "ACTIVE"


def reserve_credits(
    user_id: str,
    task_id: str,
    duration_seconds: int,
    resolution: int,
) -> dict[str, Any]:
    cost = short_cost(duration_seconds, resolution)
    is_plus = _sync_subscription(user_id)
    allowance = PLUS_DAILY_CREDITS if is_plus else FREE_DAILY_CREDITS
    today = _utc_day()
    now = datetime.now(timezone.utc).isoformat()
    connection = _connect()
    try:
        connection.execute("BEGIN IMMEDIATE")
        spent_row = connection.execute(
            """
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM credit_reservations
            WHERE user_id = ? AND credit_date = ? AND status != 'refunded'
            """,
            (user_id, today),
        ).fetchone()
        spent = int(spent_row["total"])
        remaining = max(0, allowance - spent)
        if cost > remaining:
            connection.rollback()
            raise InsufficientCreditsError(cost, remaining)
        connection.execute(
            """
            INSERT INTO credit_reservations
                (task_id, user_id, credit_date, amount, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'reserved', ?, ?)
            """,
            (task_id, user_id, today, cost, now, now),
        )
        connection.commit()
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise
    finally:
        connection.close()

    return {
        "cost": cost,
        "remaining": remaining - cost,
        "plan": "plus" if is_plus else "free",
        "daily_allowance": allowance,
    }


def settle_credits(task_id: str, succeeded: bool) -> None:
    status = "completed" if succeeded else "refunded"
    now = datetime.now(timezone.utc).isoformat()
    with closing(_connect()) as connection:
        connection.execute(
            """
            UPDATE credit_reservations
            SET status = ?, updated_at = ?
            WHERE task_id = ? AND status = 'reserved'
            """,
            (status, now, task_id),
        )


def record_task(
    *,
    task_id: str,
    user_id: str,
    source: str,
    duration_seconds: int,
    resolution: int,
    aspect_ratio: str,
    subtitles: bool,
    subtitle_color: str,
    subtitle_size: str,
    subtitle_position: str,
    subtitle_font: str = "Arial",
    credit_cost: int,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with closing(_connect()) as connection:
        connection.execute(
            """
            INSERT INTO task_history (
                task_id, user_id, source, status, progress, stage, duration_seconds,
                resolution, aspect_ratio, subtitles, subtitle_color, subtitle_size,
                subtitle_position, subtitle_font, credit_cost, created_at, updated_at
            ) VALUES (?, ?, ?, 'queued', 0, 'En attente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                user_id,
                source,
                duration_seconds,
                resolution,
                aspect_ratio,
                int(subtitles),
                subtitle_color,
                subtitle_size,
                subtitle_position,
                subtitle_font,
                credit_cost,
                now,
                now,
            ),
        )


def update_task_history(task_id: str, values: dict[str, Any]) -> None:
    fields = {
        "status",
        "progress",
        "stage",
        "error",
        "video_url",
        "titre",
        "explication",
    }
    updates = {key: value for key, value in values.items() if key in fields}
    if not updates:
        return
    columns = {
        "titre": "title",
        "explication": "explanation",
    }
    assignments = [f"{columns.get(key, key)} = ?" for key in updates]
    parameters = list(updates.values())
    assignments.append("updated_at = ?")
    parameters.extend((datetime.now(timezone.utc).isoformat(), task_id))
    with closing(_connect()) as connection:
        connection.execute(
            f"UPDATE task_history SET {', '.join(assignments)} WHERE task_id = ?",
            parameters,
        )


def list_task_history(user_id: str, limit: int = 50) -> list[dict[str, Any]]:
    with closing(_connect()) as connection:
        rows = connection.execute(
            """
            SELECT task_id, source, status, progress, stage, error, video_url,
                   title AS titre, explanation AS explication, duration_seconds,
                   resolution, aspect_ratio, subtitles, subtitle_color, subtitle_size,
                   subtitle_position, subtitle_font, credit_cost, created_at, updated_at
            FROM task_history
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (user_id, max(1, min(limit, 100))),
        ).fetchall()
    return [dict(row) for row in rows]


def get_task_history(task_id: str, user_id: str) -> dict[str, Any] | None:
    with closing(_connect()) as connection:
        row = connection.execute(
            """
            SELECT task_id, source, status, progress, stage, error, video_url,
                   title AS titre, explanation AS explication, duration_seconds,
                   resolution, aspect_ratio, subtitles, subtitle_color, subtitle_size,
                   subtitle_position, subtitle_font, credit_cost, created_at, updated_at
            FROM task_history
            WHERE task_id = ? AND user_id = ?
            """,
            (task_id, user_id),
        ).fetchone()
    return dict(row) if row is not None else None


def delete_task_history(task_id: str, user_id: str) -> bool:
    with closing(_connect()) as connection:
        cursor = connection.execute(
            """
            DELETE FROM task_history
            WHERE task_id = ? AND user_id = ?
            """,
            (task_id, user_id),
        )
        return cursor.rowcount > 0
