"""Top-level API router.

Feature routers are registered here as each phase lands:

* Phase 3 -> `app/api/routes/auth.py`         (`GET /api/auth/me`)
* Phase 4 -> `app/api/routes/diagnose.py`     (`POST /api/diagnose`, ...)
* Phase 6 -> `app/api/routes/assistant.py`    (`POST /api/assistant/message`, ...)
* Phase 7 -> `app/api/routes/communities.py`  (`/api/communities`, `/api/posts`, ...)
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import assistant, auth, communities, diagnose, health

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(diagnose.router)
api_router.include_router(assistant.router)
api_router.include_router(communities.router)
