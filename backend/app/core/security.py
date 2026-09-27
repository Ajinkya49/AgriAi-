"""Request authentication for the Agri AI API.

The frontend signs in against Supabase Auth and holds a JWT. Every protected
endpoint verifies that token here, so a handler always knows who is calling
before it touches the database.

Verification resolves the caller's subject through **PostgREST** by calling
`public.current_user_id()` with the caller's own token. Supabase verifies the
signature; the backend never needs a JWT secret, a JWKS fetch, or a JWT library,
and revoked sessions are honoured immediately.

That is deliberately the *same* path RLS uses. If identity resolves here, the
subject is what every policy sees — which is a stronger guarantee than checking a
different system and hoping the two agree.

It also keeps the backend **decoupled from GoTrue internals**. `GET /auth/v1/user`
(used before) is GoTrue's own endpoint; PostgREST instead accepts any token
Supabase can verify, which is the same check RLS relies on.

Two clients matter here:
  * the **user-scoped** client forwards the caller's token, so Row Level
    Security applies and a bug in a handler cannot leak another farmer's data;
  * the **service-role** client bypasses RLS and is reserved for the narrow
    server-side jobs that genuinely need it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# auto_error=False so we can return our own 401 shape rather than FastAPI's.
_bearer_scheme = HTTPBearer(auto_error=False, description="Supabase access token")


@dataclass(frozen=True)
class AuthUser:
    """The verified caller.

    `id` is the identity subject, as a string. `email` and `phone` are optional
    because they live in the app's own `public.users` row, not in the token.
    """

    id: str
    email: str | None = None
    phone: str | None = None


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def _resolve_identity(token: str) -> str:
    """Resolve the caller's subject and ensure they have a profile row.

    Two things in one round-trip, which is why it calls `ensure_profile()` rather
    than `current_user_id()`:

    1. **Identity.** This used to call `GET /auth/v1/user`, which is GoTrue's own
       endpoint. PostgREST instead accepts any token Supabase can verify, so the
       backend needs no JWT library, no JWKS fetching, and no coupling to the
       auth server's internal endpoints.

    2. **Provisioning.** `ensure_profile()` creates the caller's `public.users`
       row if it is missing, so a valid session can never be left without a
       profile (without one, every policy denies). For a normal signup the
       `on_auth_user_created` trigger has already created it and this is a cheap
       no-op.

    It is also the **same verification path RLS uses**. Resolving identity through
    the same system that will evaluate every policy is a stronger guarantee than
    checking a different one and hoping the two agree — if this returns a subject,
    that subject is what `public.current_user_id()` sees inside every policy.

    Verified against the live project: GoTrue and this agree on the subject, and a
    bogus token is rejected with 401. See
    `backend/scripts/verify_identity_resolution.py`.
    """
    settings = get_settings()
    if not settings.is_supabase_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase is not configured on the backend.",
        )

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{settings.supabase_url}/rest/v1/rpc/ensure_profile",
                headers={
                    "apikey": settings.supabase_anon_key,
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={},
            )
    except httpx.HTTPError as exc:
        logger.warning("Identity lookup failed: %s", exc)
        raise _unauthorized("Could not verify your session. Please try again.") from exc

    if response.status_code in (401, 403):
        raise _unauthorized("Your session has expired. Please log in again.")
    if response.status_code != 200:
        logger.warning("Identity lookup returned HTTP %s", response.status_code)
        raise _unauthorized("Your session could not be verified. Please log in again.")

    subject = response.json()
    # The function returns NULL for a token with no `sub` claim, which is a valid
    # response shape but not a valid identity.
    if not subject or not isinstance(subject, str):
        raise _unauthorized("Your session is not valid. Please log in again.")
    return subject


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
) -> AuthUser:
    """FastAPI dependency: require a valid session.

    `email` and `phone` are intentionally left unset. They belong to the app's own
    `public.users` row, which is identical for either issuer — reading them from
    an auth payload would mean this function's shape changes with the provider.
    `/auth/me` reads them from the profile row instead.
    """
    if credentials is None or not credentials.credentials:
        raise _unauthorized("Authentication required.")

    return AuthUser(id=await _resolve_identity(credentials.credentials))


async def get_optional_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
) -> AuthUser | None:
    """FastAPI dependency: identify the caller if a token is present, else None."""
    if credentials is None or not credentials.credentials:
        return None
    return AuthUser(id=await _resolve_identity(credentials.credentials))


def user_scoped_client(token: str) -> Any:
    """A Supabase client that acts *as the caller*, so RLS applies.

    Prefer this over the service-role client in every request handler.
    """
    from supabase import create_client

    settings = get_settings()
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    # Forward the caller's JWT so PostgREST evaluates auth.uid() as this user.
    client.postgrest.auth(token)
    return client


def bearer_token(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
) -> str:
    """Raw access token, for handlers that need to build a user-scoped client."""
    if credentials is None or not credentials.credentials:
        raise _unauthorized("Authentication required.")
    return credentials.credentials


CurrentUser = Annotated[AuthUser, Depends(get_current_user)]
OptionalUser = Annotated[AuthUser | None, Depends(get_optional_user)]
BearerToken = Annotated[str, Depends(bearer_token)]
