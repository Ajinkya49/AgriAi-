"""Gemini text embeddings, as a LlamaIndex `BaseEmbedding`.

Why not `llama-index-embeddings-gemini` directly: the published wrapper pins its
own list of model names, and this project needs `gemini-embedding-001` — verified
working against the project's key, returning 3072 dimensions. Implementing the
LlamaIndex `BaseEmbedding` interface over the same REST endpoint keeps the standard
`VectorStoreIndex` / retriever flow intact while leaving the model name under our
control.

If you later switch embedding models, the dimension changes and **the FAISS index
must be rebuilt** — vectors from different models are not comparable. `index.py`
stores the dimension alongside the index and refuses to load a mismatch.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

from llama_index.core.embeddings import BaseEmbedding

from app.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta"

# Gemini's batch endpoint caps how many requests one call may carry, and the free
# tier rate-limits aggressively. 20 per call with retry is well inside both.
MAX_BATCH = 20
MAX_RETRIES = 5
BASE_BACKOFF_SECONDS = 8.0


class EmbeddingError(RuntimeError):
    """Embedding failed — configuration, network or quota."""


class GeminiEmbedding(BaseEmbedding):
    """Text embeddings from Gemini's `embedContent` endpoint."""

    # Declared as a pydantic field. `BaseEmbedding` is a pydantic model, so a
    # plain `self.api_key = ...` in `__init__` would be silently dropped.
    api_key: str = ""

    @classmethod
    def create(cls) -> GeminiEmbedding:
        """Build the embedding model from application settings."""
        settings = get_settings()
        return cls(
            model_name=settings.gemini_embedding_model,
            api_key=settings.gemini_api_key,
        )

    # -- internals --------------------------------------------------------

    def _post(self, path: str, payload: dict) -> dict:
        if not self.api_key:
            raise EmbeddingError("No Gemini API key is configured.")

        request = urllib.request.Request(
            f"{GEMINI_ENDPOINT}/{path}",
            data=json.dumps(payload).encode(),
            headers={
                "x-goog-api-key": self.api_key,
                "Content-Type": "application/json",
            },
            method="POST",
        )

        # Index building is a rare offline job, so it is worth waiting out a rate
        # limit rather than failing and re-running the whole thing by hand.
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    return json.load(response)
            except urllib.error.HTTPError as exc:
                body = exc.read().decode(errors="replace")[:300]
                if exc.code == 429 and attempt < MAX_RETRIES:
                    delay = BASE_BACKOFF_SECONDS * attempt
                    logger.warning(
                        "Embedding rate limited (attempt %d/%d); retrying in %.0fs",
                        attempt,
                        MAX_RETRIES,
                        delay,
                    )
                    time.sleep(delay)
                    continue
                logger.error("Embedding HTTP %s: %s", exc.code, body)
                raise EmbeddingError(f"Embedding request failed ({exc.code}).") from exc
            except Exception as exc:  # noqa: BLE001
                logger.exception("Embedding request failed")
                raise EmbeddingError("Embedding request failed.") from exc

        raise EmbeddingError("Embedding request failed after retries.")

    def _embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        batches = [texts[i : i + MAX_BATCH] for i in range(0, len(texts), MAX_BATCH)]

        for number, batch in enumerate(batches, 1):
            body = self._post(
                f"models/{self.model_name}:batchEmbedContents",
                {
                    "requests": [
                        {
                            "model": f"models/{self.model_name}",
                            "content": {"parts": [{"text": text}]},
                        }
                        for text in batch
                    ]
                },
            )
            embeddings = body.get("embeddings") or []
            if len(embeddings) != len(batch):
                raise EmbeddingError(
                    f"Expected {len(batch)} embeddings, received {len(embeddings)}."
                )
            vectors.extend(item["values"] for item in embeddings)

            if number < len(batches):
                # Stay under the per-minute quota rather than relying on retries.
                time.sleep(2.0)

        return vectors

    # -- LlamaIndex interface ---------------------------------------------

    def _get_query_embedding(self, query: str) -> list[float]:
        return self._embed([query])[0]

    async def _aget_query_embedding(self, query: str) -> list[float]:
        return self._get_query_embedding(query)

    def _get_text_embedding(self, text: str) -> list[float]:
        return self._embed([text])[0]

    def _get_text_embeddings(self, texts: list[str]) -> list[list[float]]:
        return self._embed(texts)


def get_embed_model() -> GeminiEmbedding:
    """The embedding model used for both indexing and querying."""
    return GeminiEmbedding.create()


def embedding_dimension() -> int:
    """Probe the configured model for its output dimension.

    Called when building the index so the FAISS index is created with the right
    width, and again on load to detect a model change.
    """
    return len(get_embed_model()._get_text_embedding("dimension probe"))
