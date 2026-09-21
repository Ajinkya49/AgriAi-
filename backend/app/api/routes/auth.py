"""Auth endpoints.

Sign-up, log-in and log-out all happen directly between the browser and Supabase
Auth — the backend never handles a password. What the backend does own is
*verifying* the resulting session, which is what these endpoints demonstrate and
what every later feature phase builds on.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from app.core.logging import get_logger
from app.core.security import BearerToken, CurrentUser, user_scoped_client
from app.schemas.auth import MeOut, ProfileOut

logger = get_logger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me", response_model=MeOut)
async def read_current_user(user: CurrentUser, token: BearerToken) -> MeOut:
    """Return the verified caller and their profile row.

    The profile is read through a client carrying the caller's own JWT, so Row
    Level Security decides what comes back — this endpoint cannot return another
    farmer's profile even if the query were wrong.
    """

    def _load_profile() -> dict | None:
        client = user_scoped_client(token)
        result = client.table("users").select("*").eq("id", user.id).limit(1).execute()
        rows = result.data or []
        return rows[0] if rows else None

    # supabase-py is synchronous; keep it off the event loop.
    row = await run_in_threadpool(_load_profile)

    if row is None:
        # A valid session with no profile row means the profile was never created
        # — for Supabase the on_auth_user_created trigger did not run, and for
        # Clerk nothing creates it yet. Surface it rather than silently returning
        # null, because without the row every policy denies.
        logger.warning("No profile row for authenticated user %s", user.id)

    return MeOut(
        id=user.id,
        # Read from the profile row rather than the auth payload. The row is the
        # app's own record and looks identical for either issuer, whereas an auth
        # payload's shape differs between Supabase and Clerk.
        email=row.get("email") if row else None,
        phone=row.get("phone") if row else None,
        profile=ProfileOut(**row) if row else None,
    )
