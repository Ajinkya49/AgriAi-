"""Application settings for the Agri AI backend.

All values are read from environment variables (see `.env.example`). The variable
names match the "Environment Variables" section of `02-TRD-AgriAI.md` exactly so
the same names work locally, on Render/Railway, and on Vercel.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


def _dedupe_chain(primary: str, fallbacks: str) -> list[str]:
    """Primary model first, then the fallbacks, de-duplicated, order preserved.

    Accepts both comma- and space-separated fallback lists, because that is how
    the two providers' docs write them.
    """
    candidates = [primary, *fallbacks.replace(",", " ").split()]
    seen: set[str] = set()
    return [
        m.strip()
        for m in candidates
        if m.strip() and not (m.strip() in seen or seen.add(m.strip()))
    ]


class Settings(BaseSettings):
    """Runtime configuration loaded from the environment."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ---- App ----
    app_name: str = "Agri AI API"
    environment: str = "development"
    api_prefix: str = "/api"
    # Comma-separated list of allowed browser origins.
    cors_origins: str = "http://localhost:3000"

    # ---- Supabase (DB + Storage + Auth) ----
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_storage_bucket: str = "agri-ai"
    database_url: str = ""

    # ---- Disease detection model (PyTorch / EfficientNet-B0) ----
    # Phase 4 fills this in. Kept here so the env contract is complete from Phase 1.
    model_path: str = "app/models/weights/efficientnet_b0_agri.pt"
    model_version: str = "v1.0.0"

    # ---- RAG assistant (LlamaIndex + FAISS) ----
    faiss_index_path: str = "app/rag/index/knowledge_base.faiss"

    # ---- Conversational LLM ----
    # OpenRouter is the PRIMARY chat provider; Gemini is retained as a fallback
    # so a rate-limited free model does not leave a farmer staring at an error.
    # Both are conversation-only — image diagnosis is PyTorch (`app/models`) and
    # never touches an LLM.
    #
    # Embeddings stay on Gemini regardless. The FAISS index was built with
    # `gemini-embedding-001` and `load_index()` refuses a mismatched model, so
    # changing the embedding provider means rebuilding the index first.
    openrouter_api_key: str = ""
    # Verified working on the free tier, including Hindi in/out and the refusal
    # path. Free models are rate-limited per-model, hence the fallbacks.
    openrouter_model: str = "deepseek/deepseek-v4-flash-0731:free"
    openrouter_fallback_models: str = (
        "nvidia/nemotron-3-ultra-550b-a55b:free,google/gemma-4-31b-it:free"
    )

    gemini_api_key: str = ""
    # Verified working against this key. `gemini-2.5-flash` is retired for new
    # accounts and returns 404, and `gemini-flash-latest` intermittently 503s.
    gemini_model: str = "gemini-3.6-flash"
    gemini_embedding_model: str = "gemini-embedding-001"
    # Tried in order when the primary model returns 429/503. Free-tier capacity
    # fluctuates, and a farmer should not see an error because one model was busy.
    gemini_fallback_models: str = "gemini-3.5-flash,gemini-flash-latest,gemini-3-flash-preview"
    # Chunks to retrieve per question. Small corpus + grounded answers means a
    # narrow window is better than a wide one.
    rag_top_k: int = 5
    rag_chunk_size: int = 900
    rag_chunk_overlap: int = 150

    @property
    def cors_origin_list(self) -> list[str]:
        """Return CORS origins as a list, tolerating both comma and space separators."""
        raw = self.cors_origins.replace(",", " ").split()
        return [origin.strip() for origin in raw if origin.strip()]

    @property
    def is_supabase_configured(self) -> bool:
        """True when enough config exists to attempt a Supabase connection."""
        return bool(self.supabase_url and self.supabase_anon_key)

    @property
    def is_rag_configured(self) -> bool:
        """True when the assistant has everything it needs to answer a question.

        Either chat provider is sufficient — they are alternatives, not both
        required. The index is needed regardless.
        """
        return bool((self.openrouter_api_key or self.gemini_api_key) and self.faiss_index_path)

    @property
    def openrouter_model_chain(self) -> list[str]:
        """Chat models to try on OpenRouter, in order."""
        return _dedupe_chain(self.openrouter_model, self.openrouter_fallback_models)

    @property
    def gemini_model_chain(self) -> list[str]:
        """Chat models to try on Gemini, in order."""
        return _dedupe_chain(self.gemini_model, self.gemini_fallback_models)

    @property
    def primary_chat_model(self) -> str:
        """The chat model that will actually be tried first.

        OpenRouter when configured, otherwise Gemini. Reported by both the health
        and assistant-status endpoints so they cannot disagree about which
        provider is live — they did, and it made debugging actively misleading:
        the health check named a Gemini model while every answer was coming from
        OpenRouter.
        """
        return self.openrouter_model if self.openrouter_api_key else self.gemini_model

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() in {"production", "prod"}

    def production_problems(self) -> list[str]:
        """Configuration that is wrong or missing for a production deploy.

        Returns an empty list outside production, so local development is never
        blocked by this. The caller decides what to do — the app still boots, so
        the platform can serve a readable error rather than a container that dies
        before its health check ever runs.
        """
        if not self.is_production:
            return []

        problems: list[str] = []

        # ---- Must be present, or the app cannot function at all ----
        if not self.supabase_url:
            problems.append("SUPABASE_URL is not set — auth and the database are unusable.")
        if not self.supabase_anon_key:
            problems.append("SUPABASE_ANON_KEY is not set — RLS-scoped reads will fail.")
        if not self.supabase_service_role_key:
            problems.append("SUPABASE_SERVICE_ROLE_KEY is not set — image uploads will fail.")
        if not self.database_url:
            problems.append("DATABASE_URL is not set.")

        # ---- Assistant: degraded, not fatal ----
        if not self.openrouter_api_key and not self.gemini_api_key:
            problems.append(
                "Neither OPENROUTER_API_KEY nor GEMINI_API_KEY is set — the assistant "
                "will return 503."
            )
        elif not self.gemini_api_key:
            problems.append(
                "GEMINI_API_KEY is not set — chat still works via OpenRouter, but the "
                "FAISS index cannot be rebuilt (embeddings are Gemini-only)."
            )

        # ---- CORS: the most common deploy mistake ----
        origins = self.cors_origin_list
        if not origins:
            problems.append("CORS_ORIGINS is empty — the frontend will be blocked.")
        else:
            local = [o for o in origins if "localhost" in o or "127.0.0.1" in o]
            if local:
                problems.append(
                    f"CORS_ORIGINS still contains local origins ({', '.join(local)}) — the "
                    "deployed frontend will be blocked unless its origin is added."
                )
            insecure = [o for o in origins if o.startswith("http://")]
            if insecure:
                problems.append(f"CORS_ORIGINS contains non-HTTPS origins ({', '.join(insecure)}).")

        return problems


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance (read the environment only once)."""
    return Settings()
