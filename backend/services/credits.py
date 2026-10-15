from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .paypal import verify_subscription

BASE_DIR = Path(__file__).resolve().parents[1]
FREE_DAILY_CREDITS = 10
PLUS_DAILY_CREDITS = 100
ALLOWED_DURATIONS = {30, 45, 55}
ALLOWED_RESOLUTIONS = {720, 1080}
MAX_UPLOAD_BYTES = 250 * 1024 * 1024
MAX_OUTPUT_BYTES = 100 * 1024 * 1024
MAX_STORAGE_BYTES = 750 * 1024 * 1024
_database_lock = threading.Lock()
_initialized_database: Path | str | None = None


class StorageQuotaError(ValueError):
    pass


class _DatabaseConnection:
    def __init__(self, connection: Any, *, postgres: bool) -> None:
        self._connection = connection
        self.is_postgres = postgres

    def execute(self, statement: str, parameters: tuple[Any, ...] = ()) -> Any:
        if self.is_postgres:
            statement = statement.replace("?", "%s")
        return self._connection.execute(statement, parameters)

    def executescript(self, script: str) -> None:
        if not self.is_postgres:
            self._connection.executescript(script)
            return
        for statement in script.split(";"):
            if statement.strip():
                self.execute(statement)

    @property
    def in_transaction(self) -> bool:
        if not self.is_postgres:
            return self._connection.in_transaction
        from psycopg.pq import TransactionStatus

        return self._connection.info.transaction_status != TransactionStatus.IDLE

    def begin(self) -> None:
        self.execute("BEGIN" if self.is_postgres else "BEGIN IMMEDIATE")

    def commit(self) -> None:
        self._connection.commit()

    def rollback(self) -> None:
        self._connection.rollback()

    def close(self) -> None:
        self._connection.close()


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


def _database_url() -> str:
    value = os.getenv("DATABASE_URL", "").strip()
    if value.startswith(("postgres://", "postgresql://")):
        return value
    if os.getenv("VERCEL"):
        raise RuntimeError("DATABASE_URL doit pointer vers la base PostgreSQL Neon.")
    return ""


def _open_connection() -> _DatabaseConnection:
    database_url = _database_url()
    if database_url:
        import psycopg
        from psycopg.rows import dict_row

        return _DatabaseConnection(
            psycopg.connect(database_url, row_factory=dict_row, autocommit=True),
            postgres=True,
        )

    database_path = _database_path()
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path, timeout=15, isolation_level=None)
    connection.row_factory = sqlite3.Row
    return _DatabaseConnection(connection, postgres=False)


def _database_key() -> Path | str:
    return _database_url() or _database_path()


def _initialize() -> None:
    global _initialized_database
    database_key = _database_key()
    with _database_lock:
        if _initialized_database == database_key:
            return
        connection = _open_connection()
        try:
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
                    output_bytes INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS task_history_user_date_idx
                    ON task_history(user_id, created_at DESC);
                CREATE TABLE IF NOT EXISTS task_payloads (
                    task_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    job_status TEXT NOT NULL DEFAULT 'idle',
                    lease_until TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS task_payloads_queue_idx
                    ON task_payloads(job_status, created_at);
                CREATE TABLE IF NOT EXISTS media_uploads (
                    upload_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    pathname TEXT NOT NULL UNIQUE,
                    blob_url TEXT,
                    input_reserved_bytes INTEGER NOT NULL DEFAULT 0,
                    output_reserved_bytes INTEGER NOT NULL DEFAULT 0,
                    actual_bytes INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL CHECK (
                        status IN ('reserved', 'uploaded', 'attached', 'task', 'deleted')
                    ),
                    task_id TEXT UNIQUE,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS media_uploads_status_idx
                    ON media_uploads(status, created_at);
                """
            )
            if connection.is_postgres:
                connection.execute(
                    "ALTER TABLE task_history ADD COLUMN IF NOT EXISTS "
                    "subtitle_font TEXT NOT NULL DEFAULT 'Arial'"
                )
                connection.execute(
                    "ALTER TABLE task_history ADD COLUMN IF NOT EXISTS "
                    "output_bytes INTEGER NOT NULL DEFAULT 0"
                )
            else:
                task_history_columns = {
                    row[1]
                    for row in connection.execute("PRAGMA table_info(task_history)")
                }
                if "subtitle_font" not in task_history_columns:
                    connection.execute(
                        "ALTER TABLE task_history ADD COLUMN subtitle_font "
                        "TEXT NOT NULL DEFAULT 'Arial'"
                    )
                if "output_bytes" not in task_history_columns:
                    connection.execute(
                        "ALTER TABLE task_history ADD COLUMN output_bytes "
                        "INTEGER NOT NULL DEFAULT 0"
                    )
        finally:
            connection.close()
        _initialized_database = database_key


def _connect() -> _DatabaseConnection:
    _initialize()
    return _open_connection()


def _lock_storage_quota(connection: _DatabaseConnection) -> None:
    if connection.is_postgres:
        connection.execute("SELECT pg_advisory_xact_lock(278419531)")


def _begin(connection: _DatabaseConnection) -> None:
    connection.begin()
    _lock_storage_quota(connection)


def _storage_in_use(connection: _DatabaseConnection) -> int:
    reserved = connection.execute(
        """
        SELECT COALESCE(SUM(input_reserved_bytes + output_reserved_bytes), 0) AS total
        FROM media_uploads
        WHERE status IN ('reserved', 'uploaded', 'attached', 'task')
        """
    ).fetchone()["total"]
    stored = connection.execute(
        "SELECT COALESCE(SUM(output_bytes), 0) AS total FROM task_history "
        "WHERE status = 'completed'"
    ).fetchone()["total"]
    return int(reserved) + int(stored)


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
    except Exception as exc:
        if not _is_integrity_error(exc):
            raise
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
        connection.begin()
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
        if cursor.rowcount:
            connection.execute("DELETE FROM task_payloads WHERE task_id = ?", (task_id,))
            connection.execute(
                """
                UPDATE media_uploads
                SET status = 'deleted', input_reserved_bytes = 0,
                    output_reserved_bytes = 0, updated_at = ?
                WHERE task_id = ? OR upload_id = ?
                """,
                (datetime.now(timezone.utc).isoformat(), task_id, task_id),
            )
        return cursor.rowcount > 0


def _is_integrity_error(error: Exception) -> bool:
    if isinstance(error, sqlite3.IntegrityError):
        return True
    try:
        import psycopg
    except ImportError:
        return False
    return isinstance(error, psycopg.IntegrityError)


def save_task_payload(
    task_id: str,
    payload: dict[str, Any],
    *,
    job_status: str = "queued",
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    serialized = json.dumps(payload, ensure_ascii=False)
    with closing(_connect()) as connection:
        connection.execute(
            """
            INSERT INTO task_payloads (task_id, payload, job_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(task_id) DO UPDATE SET
                payload = excluded.payload,
                job_status = excluded.job_status,
                lease_until = NULL,
                updated_at = excluded.updated_at
            """,
            (task_id, serialized, job_status, now, now),
        )


def get_task_payload(task_id: str) -> dict[str, Any] | None:
    with closing(_connect()) as connection:
        row = connection.execute(
            "SELECT payload FROM task_payloads WHERE task_id = ?",
            (task_id,),
        ).fetchone()
    if row is None:
        return None
    value = json.loads(str(row["payload"]))
    return value if isinstance(value, dict) else None


def get_media_upload(upload_id: str, user_id: str) -> dict[str, Any] | None:
    with closing(_connect()) as connection:
        row = connection.execute(
            """
            SELECT upload_id, user_id, pathname, blob_url, input_reserved_bytes,
                   output_reserved_bytes, actual_bytes, status, task_id, created_at
            FROM media_uploads
            WHERE upload_id = ? AND user_id = ?
            """,
            (upload_id, user_id),
        ).fetchone()
    return dict(row) if row is not None else None


def reserve_upload_storage(user_id: str, upload_id: str, pathname: str) -> None:
    if not pathname.startswith(f"uploads/{user_id}/") or ".." in pathname.split("/"):
        raise ValueError("Chemin de téléversement invalide.")
    now = datetime.now(timezone.utc).isoformat()
    connection = _connect()
    try:
        _begin(connection)
        if _storage_in_use(connection) + MAX_UPLOAD_BYTES + MAX_OUTPUT_BYTES > MAX_STORAGE_BYTES:
            connection.rollback()
            raise StorageQuotaError(
                "Le stockage gratuit est presque plein. Supprimez des Shorts ou réessayez plus tard."
            )
        connection.execute(
            """
            INSERT INTO media_uploads (
                upload_id, user_id, pathname, input_reserved_bytes,
                output_reserved_bytes, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?)
            """,
            (upload_id, user_id, pathname, MAX_UPLOAD_BYTES, MAX_OUTPUT_BYTES, now, now),
        )
        connection.commit()
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise
    finally:
        connection.close()


def complete_upload_storage(
    upload_id: str,
    pathname: str,
    blob_url: str,
    actual_bytes: int,
) -> None:
    if actual_bytes <= 0 or actual_bytes > MAX_UPLOAD_BYTES:
        raise ValueError("La vidéo dépasse la limite gratuite de 250 Mo.")
    now = datetime.now(timezone.utc).isoformat()
    connection = _connect()
    try:
        connection.begin()
        select = (
            """
            SELECT blob_url, actual_bytes, status
            FROM media_uploads
            WHERE upload_id = ? AND pathname = ?
            """
        )
        if connection.is_postgres:
            select += " FOR UPDATE"
        row = connection.execute(
            select,
            (upload_id, pathname),
        ).fetchone()
        if (
            row is not None
            and row["status"] == "uploaded"
            and row["blob_url"] == blob_url
            and int(row["actual_bytes"]) == actual_bytes
        ):
            connection.commit()
            return
        if row is None or row["status"] != "reserved":
            connection.rollback()
            raise ValueError("Ce téléversement n’est plus valide.")
        cursor = connection.execute(
            """
            UPDATE media_uploads
            SET blob_url = ?, actual_bytes = ?, input_reserved_bytes = ?,
                status = 'uploaded', updated_at = ?
            WHERE upload_id = ? AND pathname = ? AND status = 'reserved'
            """,
            (blob_url, actual_bytes, actual_bytes, now, upload_id, pathname),
        )
        if cursor.rowcount != 1:
            connection.rollback()
            raise ValueError("Ce téléversement n’est plus valide.")
        connection.commit()
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise
    finally:
        connection.close()


def reserve_task_storage(task_id: str, user_id: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    connection = _connect()
    try:
        _begin(connection)
        if _storage_in_use(connection) + MAX_OUTPUT_BYTES > MAX_STORAGE_BYTES:
            connection.rollback()
            raise StorageQuotaError(
                "Le stockage gratuit est presque plein. Supprimez des Shorts ou réessayez plus tard."
            )
        connection.execute(
            """
            INSERT INTO media_uploads (
                upload_id, user_id, pathname, output_reserved_bytes,
                status, task_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'task', ?, ?, ?)
            """,
            (task_id, user_id, f"tasks/{task_id}", MAX_OUTPUT_BYTES, task_id, now, now),
        )
        connection.commit()
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise
    finally:
        connection.close()


def attach_upload_to_task(upload_id: str, user_id: str, task_id: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    connection = _connect()
    try:
        connection.begin()
        row = connection.execute(
            """
            SELECT pathname, blob_url, actual_bytes, status
            FROM media_uploads
            WHERE upload_id = ? AND user_id = ?
            """,
            (upload_id, user_id),
        ).fetchone()
        if row is None or row["status"] != "uploaded" or not row["blob_url"]:
            connection.rollback()
            raise ValueError("Le téléversement est introuvable ou expiré.")
        cursor = connection.execute(
            """
            UPDATE media_uploads
            SET status = 'attached', task_id = ?, updated_at = ?
            WHERE upload_id = ? AND user_id = ? AND status = 'uploaded'
            """,
            (task_id, now, upload_id, user_id),
        )
        if cursor.rowcount != 1:
            connection.rollback()
            raise ValueError("Ce téléversement a déjà été utilisé.")
        connection.commit()
        return dict(row)
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise
    finally:
        connection.close()


def update_task_source_storage(task_id: str, blob_url: str, actual_bytes: int) -> None:
    if actual_bytes <= 0 or actual_bytes > MAX_UPLOAD_BYTES:
        raise ValueError("La vidéo source dépasse la limite gratuite de 250 Mo.")
    now = datetime.now(timezone.utc).isoformat()
    connection = _connect()
    try:
        _begin(connection)
        row = connection.execute(
            """
            SELECT input_reserved_bytes, output_reserved_bytes
            FROM media_uploads WHERE task_id = ? AND status IN ('attached', 'task')
            """,
            (task_id,),
        ).fetchone()
        if row is None:
            connection.rollback()
            raise ValueError("La réservation de stockage de cette tâche a expiré.")
        used = _storage_in_use(connection) - int(row["input_reserved_bytes"])
        if used + actual_bytes > MAX_STORAGE_BYTES:
            connection.rollback()
            raise StorageQuotaError(
                "Le stockage gratuit est presque plein. Supprimez des Shorts ou réessayez plus tard."
            )
        connection.execute(
            """
            UPDATE media_uploads
            SET blob_url = ?, input_reserved_bytes = ?, actual_bytes = ?, updated_at = ?
            WHERE task_id = ?
            """,
            (blob_url, actual_bytes, actual_bytes, now, task_id),
        )
        connection.commit()
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise
    finally:
        connection.close()


def release_task_storage(task_id: str) -> None:
    with closing(_connect()) as connection:
        connection.execute(
            """
            UPDATE media_uploads
            SET status = 'deleted', input_reserved_bytes = 0,
                output_reserved_bytes = 0, updated_at = ?
            WHERE task_id = ? OR upload_id = ?
            """,
            (datetime.now(timezone.utc).isoformat(), task_id, task_id),
        )


def complete_task_storage(task_id: str, output_bytes: int) -> None:
    if output_bytes <= 0 or output_bytes > MAX_OUTPUT_BYTES:
        raise ValueError("Le Short dépasse la limite de stockage gratuite.")
    now = datetime.now(timezone.utc).isoformat()
    connection = _connect()
    try:
        _begin(connection)
        row = connection.execute(
            "SELECT task_id FROM media_uploads WHERE task_id = ? AND status IN ('attached', 'task')",
            (task_id,),
        ).fetchone()
        if row is None:
            connection.rollback()
            raise ValueError("La réservation de stockage de cette tâche a expiré.")
        connection.execute(
            "UPDATE task_history SET output_bytes = ?, updated_at = ? WHERE task_id = ?",
            (output_bytes, now, task_id),
        )
        connection.execute(
            """
            UPDATE media_uploads
            SET status = 'deleted', input_reserved_bytes = 0,
                output_reserved_bytes = 0, updated_at = ?
            WHERE task_id = ?
            """,
            (now, task_id),
        )
        connection.commit()
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise
    finally:
        connection.close()


def set_task_job_status(
    task_id: str,
    payload: dict[str, Any],
    job_status: str,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with closing(_connect()) as connection:
        connection.execute(
            """
            UPDATE task_payloads
            SET payload = ?, job_status = ?, lease_until = NULL, updated_at = ?
            WHERE task_id = ?
            """,
            (json.dumps(payload, ensure_ascii=False), job_status, now, task_id),
        )


def claim_next_task() -> dict[str, Any] | None:
    now = datetime.now(timezone.utc)
    lease_until = (now + timedelta(hours=7)).isoformat()
    now_text = now.isoformat()
    connection = _connect()
    try:
        connection.begin()
        query = """
            SELECT h.*, p.payload
            FROM task_history AS h
            JOIN task_payloads AS p ON p.task_id = h.task_id
            WHERE p.job_status = 'queued'
               OR (p.job_status = 'processing' AND p.lease_until < ?)
            ORDER BY h.created_at
            LIMIT 1
        """
        if connection.is_postgres:
            query += " FOR UPDATE OF p SKIP LOCKED"
        row = connection.execute(query, (now_text,)).fetchone()
        if row is None:
            connection.commit()
            return None
        payload = json.loads(str(row["payload"]))
        connection.execute(
            """
            UPDATE task_payloads
            SET job_status = 'processing', lease_until = ?, updated_at = ?
            WHERE task_id = ?
            """,
            (lease_until, now_text, row["task_id"]),
        )
        stage = (
            "Traitement Whisper sur GitHub"
            if payload.get("job_kind") == "analyze"
            else "Montage vidéo sur GitHub"
        )
        connection.execute(
            """
            UPDATE task_history SET status = 'processing', progress = 1,
                stage = ?, updated_at = ? WHERE task_id = ?
            """,
            (stage, now_text, row["task_id"]),
        )
        connection.commit()
        result = dict(row)
        result["payload"] = payload
        result["stage"] = stage
        result["status"] = "processing"
        result["progress"] = 1
        return result
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise
    finally:
        connection.close()


def expire_upload_reservations(cutoff: str) -> list[dict[str, Any]]:
    connection = _connect()
    try:
        connection.begin()
        rows = connection.execute(
            """
            SELECT upload_id, pathname, blob_url
            FROM media_uploads
            WHERE status IN ('reserved', 'uploaded') AND task_id IS NULL
              AND created_at < ?
            """,
            (cutoff,),
        ).fetchall()
        connection.commit()
        return [dict(row) for row in rows]
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise
    finally:
        connection.close()


def list_expired_tasks(cutoff: str) -> list[dict[str, Any]]:
    with closing(_connect()) as connection:
        rows = connection.execute(
            """
            SELECT h.task_id, h.user_id, h.status, h.created_at, h.output_bytes,
                   p.payload
            FROM task_history AS h
            LEFT JOIN task_payloads AS p ON p.task_id = h.task_id
            WHERE h.created_at < ? AND h.status IN ('completed', 'review')
            """,
            (cutoff,),
        ).fetchall()
    results: list[dict[str, Any]] = []
    for row in rows:
        value = dict(row)
        payload = value.pop("payload")
        value["payload"] = json.loads(str(payload)) if payload else {}
        results.append(value)
    return results


def list_abandoned_reviews(cutoff: str) -> list[dict[str, Any]]:
    with closing(_connect()) as connection:
        rows = connection.execute(
            """
            SELECT h.task_id, h.user_id, p.payload
            FROM task_history AS h
            JOIN task_payloads AS p ON p.task_id = h.task_id
            WHERE h.status = 'review' AND h.updated_at < ?
            """,
            (cutoff,),
        ).fetchall()
    return [
        {
            "task_id": row["task_id"],
            "user_id": row["user_id"],
            "payload": json.loads(str(row["payload"])),
        }
        for row in rows
    ]
