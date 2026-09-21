"""Agri AI — FastAPI application entrypoint.

Architectural note (non-negotiable per the TRD):
the disease-detection model and the conversational LLM live in separate modules
and never share responsibility.

* `app/models/`  -> PyTorch / EfficientNet-B0 inference. Never calls Gemini.
* `app/rag/`     -> LlamaIndex + FAISS retrieval and Gemini generation. Never
                    performs image diagnosis.

Phase 1 wires the app skeleton, health checks and the router.
Phase 4 loads the PyTorch weights at startup and serves `/api/diagnose`.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.config import get_settings
from app.core.logging import configure_logging, get_logger

settings = get_settings()
configure_logging(settings.environment)
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown hooks.

    The PyTorch weights are loaded here — once, at startup, never per request
    (TRD). Loading is CPU-bound, so it runs in a threadpool rather than blocking
    the event loop. A failure is non-fatal: the API still serves health and
    reports the model as unavailable, and `/api/diagnose` returns 503.

    Phase 6 will reload the persisted FAISS index here too.
    """
    logger.info("Starting %s (env=%s)", settings.app_name, settings.environment)
    logger.info("Supabase configured: %s", settings.is_supabase_configured)

    # Misconfiguration is reported loudly at startup rather than left to surface as
    # a confusing runtime failure. The app still boots so the platform's health
    # check passes and the problem is readable from /api/health/dependencies —
    # a container that dies on boot tells an operator far less.
    problems = settings.production_problems()
    if problems:
        logger.error("=" * 70)
        logger.error("PRODUCTION CONFIGURATION PROBLEMS (%d):", len(problems))
        for problem in problems:
            logger.error("  - %s", problem)
        logger.error("=" * 70)

    from app.models.loader import load_model

    loaded = await run_in_threadpool(load_model)
    if loaded is None:
        logger.warning("Starting without a disease-detection model; /api/diagnose will 503")
    else:
        logger.info("Disease detection ready (%d classes)", loaded.num_classes)

    # The FAISS index is loaded here too — never rebuilt per request (TRD).
    from app.rag.index import load_index

    index = await run_in_threadpool(load_index)
    if index is None:
        logger.warning("Starting without the assistant index; /api/assistant will 503")
    else:
        logger.info("Farming assistant ready (%d chunks)", index.chunk_count)

    yield

    logger.info("Shutting down %s", settings.app_name)


app = FastAPI(
    title=settings.app_name,
    description=(
        "AI-powered agriculture platform for Indian farmers. "
        "Detect crop diseases, discover natural and traditional solutions, "
        "ask a grounded farming assistant, and learn from other farmers."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_prefix)


@app.get("/", tags=["meta"])
async def root() -> dict[str, str]:
    """Placeholder root endpoint proving the API is up."""
    return {
        "name": settings.app_name,
        "status": "ok",
        "docs": "/docs",
        "health": f"{settings.api_prefix}/health",
    }
