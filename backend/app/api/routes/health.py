"""Health and readiness endpoints.

`/api/health` is the Phase 1 "placeholder endpoint" from the Implementation Plan:
it proves the FastAPI app boots, and it reports whether Supabase is reachable.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.config import get_settings
from app.core.supabase_client import check_supabase_connection

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, object]:
    """Liveness probe — always fast, no external calls."""
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.app_name,
        "environment": settings.environment,
        "version": "0.1.0",
    }


@router.get("/health/dependencies")
async def health_dependencies() -> dict[str, object]:
    """Readiness probe — reports downstream dependency status."""
    from app.models.labels import DIAGNOSABLE_CROPS
    from app.models.loader import get_load_error, get_loaded_model
    from app.rag.index import get_index
    from app.rag.index import get_load_error as get_index_error

    settings = get_settings()
    model = get_loaded_model()
    index = get_index()

    return {
        "status": "ok",
        "environment": settings.environment,
        # Empty in development. In production this lists what is missing or unsafe,
        # so a misconfigured deploy is diagnosable without reading container logs.
        "config_problems": settings.production_problems(),
        "supabase": check_supabase_connection(),
        "model": {
            "configured": bool(settings.model_path),
            "path": settings.model_path,
            "version": model.version if model else settings.model_version,
            "loaded": model is not None,
            "num_classes": model.num_classes if model else None,
            # The crops this model can actually diagnose, derived from the
            # taxonomy rather than hand-listed, so it cannot drift from the
            # trained checkpoint. The app uses it to warn a farmer whose crop is
            # outside the trained set — a classifier with a fixed output layer
            # cannot report "not one of mine", so without this it would answer
            # anyway and look confident.
            "diagnosable_crops": list(DIAGNOSABLE_CROPS),
            "error": None if model else get_load_error(),
        },
        "rag": {
            "configured": settings.is_rag_configured,
            "index_path": settings.faiss_index_path,
            "loaded": index is not None,
            "chunk_count": index.chunk_count if index else None,
            "embedding_model": index.embedding_model if index else None,
            "chat_model": settings.primary_chat_model,
            "error": None if index else get_index_error(),
        },
        "weather": {
            "configured": settings.is_weather_configured,
            "provider": "IMD (api.imd.gov.in)",
        },
    }
