"""Similarity search over the curated knowledge base.

Reads the index loaded once at startup by `app/main.py`. Never rebuilds it.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config import get_settings
from app.core.logging import get_logger
from app.rag.embeddings import get_embed_model
from app.rag.index import LoadedIndex, RetrievedChunk, get_index

logger = get_logger(__name__)

# Below this cosine similarity a chunk is not really about the question. Passing
# weak matches to the model is how a grounded assistant starts sounding confident
# about the wrong thing, so they are dropped rather than padded in.
MIN_SCORE = 0.55


@dataclass(frozen=True)
class Retrieval:
    chunks: tuple[RetrievedChunk, ...]
    query: str

    @property
    def is_empty(self) -> bool:
        return not self.chunks

    def passages(self) -> list[str]:
        """Numbered excerpts ready to hand to the model."""
        return [f"{c.text}\n(Source: {c.source})" for c in self.chunks]

    def sources(self) -> list[dict]:
        """Citation records for the API response and the UI."""
        return [
            {
                "index": i + 1,
                "source": c.source,
                "score": round(c.score, 4),
                "excerpt": _excerpt(c.text),
            }
            for i, c in enumerate(self.chunks)
        ]


def _excerpt(text: str, limit: int = 280) -> str:
    """A short, readable preview of a chunk for the sources panel."""
    body = text.split("\n\n", 1)[-1].strip().replace("\n", " ")
    if len(body) <= limit:
        return body
    return body[:limit].rsplit(" ", 1)[0] + "…"


def retrieve(
    question: str, *, top_k: int | None = None, index: LoadedIndex | None = None
) -> Retrieval:
    """Find the knowledge-base chunks most relevant to `question`.

    Returns an empty retrieval rather than raising when the index is unavailable —
    the caller decides how to tell the farmer.
    """
    settings = get_settings()
    loaded = index or get_index()

    if loaded is None:
        logger.warning("Retrieval attempted with no index loaded")
        return Retrieval(chunks=(), query=question)

    question = question.strip()
    if not question:
        return Retrieval(chunks=(), query=question)

    k = top_k or settings.rag_top_k

    try:
        vector = get_embed_model()._get_query_embedding(question)
    except Exception:  # noqa: BLE001 - a failed embed should not 500 the request
        logger.exception("Could not embed the question")
        return Retrieval(chunks=(), query=question)

    hits = [hit for hit in loaded.search(vector, k) if hit.score >= MIN_SCORE]

    if not hits:
        # Worth knowing about: either the corpus has a real gap, or MIN_SCORE is
        # too aggressive for the question phrasing.
        logger.info("No chunk scored above %.2f for question %r", MIN_SCORE, question[:80])

    return Retrieval(chunks=tuple(hits), query=question)
