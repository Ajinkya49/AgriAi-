"""Supabase Storage helpers for crop images.

The bucket is **private**; images are served through short-lived signed URLs.
That is why `image_url` in the `diagnoses` table stores the *object path*, not a
public URL — a stored public URL would either break or leak.

Object layout (Backend Schema):
    uploads/{user_id}/{diagnosis_id}.jpg
    posts/{post_id}/{image_id}.jpg
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config import get_settings
from app.core.logging import get_logger
from app.core.supabase_client import get_supabase_service_client

logger = get_logger(__name__)

# Signed URL lifetime. Long enough for a farmer to view the result, short enough
# that a leaked URL is not a lasting exposure.
SIGNED_URL_TTL_SECONDS = 60 * 60


class StorageError(RuntimeError):
    """Upload or signing failed. Message is safe to show a farmer."""


def diagnosis_image_path(user_id: str, diagnosis_id: str) -> str:
    """The canonical object path for a diagnosis image."""
    return f"uploads/{user_id}/{diagnosis_id}.jpg"


def _bucket() -> str:
    return get_settings().supabase_storage_bucket


def upload_image(path: str, data: bytes, *, content_type: str = "image/jpeg") -> str:
    """Upload bytes to the private bucket. Returns the stored object path."""
    client = get_supabase_service_client()
    if client is None:
        raise StorageError("Image storage is not configured on the backend.")

    try:
        client.storage.from_(_bucket()).upload(
            path,
            data,
            {"content-type": content_type, "upsert": "true"},
        )
    except Exception as exc:  # noqa: BLE001 - surface any storage/driver error
        logger.exception("Storage upload failed for %s", path)
        raise StorageError("We could not save your photo. Please try again.") from exc

    return path


def signed_url(path: str, *, expires_in: int = SIGNED_URL_TTL_SECONDS) -> str | None:
    """Create a short-lived signed URL for a stored object.

    Returns None rather than raising: a failed signature should degrade the image
    to a placeholder, not break the whole diagnosis screen.
    """
    if not path:
        return None

    client = get_supabase_service_client()
    if client is None:
        return None

    try:
        result = client.storage.from_(_bucket()).create_signed_url(path, expires_in)
    except Exception:  # noqa: BLE001
        logger.warning("Could not sign URL for %s", path, exc_info=True)
        return None

    if isinstance(result, dict):
        # supabase-py has returned both keys across versions.
        return result.get("signedURL") or result.get("signedUrl") or result.get("signed_url")
    return None


def remove_image(path: str) -> bool:
    """Delete an object. Used to clean up after a failed diagnosis insert.

    Best-effort: returns False instead of raising, because this only ever runs on
    an error path where the original failure is the one worth reporting.
    """
    client = get_supabase_service_client()
    if client is None or not path:
        return False
    try:
        client.storage.from_(_bucket()).remove([path])
        return True
    except Exception:  # noqa: BLE001
        logger.warning("Could not remove orphaned object %s", path, exc_info=True)
        return False


@dataclass(frozen=True)
class StoredImage:
    path: str
    signed_url: str | None
