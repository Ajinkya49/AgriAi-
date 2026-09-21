"""Supabase client wiring for the Agri AI backend.

The backend uses two clients, matching the security model in
`05-BackendSchema-AgriAI.md`:

* **anon client** – acts with the caller's identity. Row Level Security applies.
  This is the default client and what request handlers should use.
* **service client** – bypasses RLS. Only for trusted server-side jobs such as
  the diagnosis insert performed after model inference, and the `solutions`
  knowledge-base seeding scripts.

Note: RLS itself is *defined in the database* (Phase 2), not here. This module
only provides the connections.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from app.config import get_settings


@lru_cache
def get_supabase_client() -> Any | None:
    """Return a cached RLS-respecting Supabase client, or None if unconfigured."""
    settings = get_settings()
    if not settings.is_supabase_configured:
        return None

    from supabase import create_client

    return create_client(settings.supabase_url, settings.supabase_anon_key)


@lru_cache
def get_supabase_service_client() -> Any | None:
    """Return a cached service-role Supabase client, or None if unconfigured."""
    settings = get_settings()
    if not (settings.supabase_url and settings.supabase_service_role_key):
        return None

    from supabase import create_client

    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def check_supabase_connection() -> dict[str, Any]:
    """Probe Supabase and report a structured status for the health endpoint.

    Returns a dict rather than raising so that a missing or unreachable Supabase
    project never takes the whole API down during early development.
    """
    settings = get_settings()

    if not settings.is_supabase_configured:
        return {
            "configured": False,
            "connected": False,
            "detail": "SUPABASE_URL / SUPABASE_ANON_KEY are not set in the backend .env",
        }

    client = get_supabase_client()
    if client is None:  # pragma: no cover - guarded by the check above
        return {"configured": True, "connected": False, "detail": "client not initialised"}

    try:
        # `users` is the first table in the Backend Schema, so it is a good
        # canary. It does not exist until Phase 2 - a "relation does not exist"
        # error still proves we reached Postgres with valid credentials.
        client.table("users").select("id").limit(1).execute()
        return {"configured": True, "connected": True, "detail": "reachable"}
    except Exception as exc:  # noqa: BLE001 - surface any driver/network error
        message = str(exc)
        if "does not exist" in message or "PGRST205" in message or "42P01" in message:
            return {
                "configured": True,
                "connected": True,
                "detail": "reachable (schema not applied yet - expected before Phase 2)",
            }
        return {"configured": True, "connected": False, "detail": message}
