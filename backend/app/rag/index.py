"""Build and load the persisted FAISS index.

The index is built **offline** by `scripts/build_faiss_index.py` and only *loaded*
at API startup (TRD: never rebuilt per request). `app/main.py` calls `load_index()`
from its lifespan handler.

Two artefacts are written:

    app/rag/index/knowledge_base.faiss       the raw FAISS binary
    app/rag/index/knowledge_base.meta.json   chunk texts, metadata, and the
                                             embedding model + dimension it was
                                             built with

The metadata file is not optional. A FAISS index is just numbers — without the
chunk text alongside it there is nothing to show as a citation, and without the
recorded dimension there is no way to detect that the embedding model changed.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from app.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

INDEX_FILENAME = "knowledge_base.faiss"
META_FILENAME = "knowledge_base.meta.json"

# Bump when the chunking strategy changes, so a stale index is rebuilt rather
# than silently serving differently-shaped chunks.
INDEX_FORMAT_VERSION = 1


@dataclass(frozen=True)
class RetrievedChunk:
    """One knowledge-base excerpt returned by a similarity search."""

    text: str
    source: str
    score: float
    chunk_index: int


@dataclass
class LoadedIndex:
    """The in-memory index plus everything needed to interpret a hit."""

    chunks: list[dict]
    vectors: object  # faiss.Index
    embedding_model: str
    dimension: int
    built_at: str
    source_files: list[str]

    @property
    def chunk_count(self) -> int:
        return len(self.chunks)

    def search(self, query_vector: list[float], top_k: int) -> list[RetrievedChunk]:
        import numpy as np

        if self.chunk_count == 0:
            return []

        vector = np.asarray([query_vector], dtype="float32")
        scores, indices = self.vectors.search(vector, min(top_k, self.chunk_count))

        results: list[RetrievedChunk] = []
        for score, idx in zip(scores[0], indices[0], strict=False):
            if idx < 0:
                continue
            chunk = self.chunks[int(idx)]
            results.append(
                RetrievedChunk(
                    text=chunk["text"],
                    source=chunk.get("source", "unknown"),
                    score=float(score),
                    chunk_index=int(idx),
                )
            )
        return results


_state: LoadedIndex | None = None
_load_error: str | None = None


def get_index() -> LoadedIndex | None:
    """The loaded index, or None if it has not been loaded successfully."""
    return _state


def get_load_error() -> str | None:
    """Why loading failed, if it did."""
    return _load_error


def index_directory() -> Path:
    """Directory holding the persisted index, resolved relative to backend/.

    `FAISS_INDEX_PATH` names the `.faiss` file. The index also needs a metadata
    sidecar, so both live in that file's parent directory — the suffix is
    stripped here rather than treated as a directory name.
    """
    configured = Path(get_settings().faiss_index_path)
    directory = configured.parent if configured.suffix == ".faiss" else configured
    if directory.is_absolute():
        return directory
    return Path(__file__).resolve().parents[2] / directory


def load_index(*, force: bool = False) -> LoadedIndex | None:
    """Load the persisted index into memory.

    Returns None (with the reason available from `get_load_error()`) rather than
    raising — the API must still boot and serve everything else when the index is
    missing.
    """
    global _state, _load_error

    if _state is not None and not force:
        return _state

    import faiss
    import numpy as np

    directory = index_directory()
    index_path = directory / INDEX_FILENAME
    meta_path = directory / META_FILENAME

    if not index_path.exists() or not meta_path.exists():
        _load_error = (
            f"No index at {index_path}. Build one with " f"`python scripts/build_faiss_index.py`."
        )
        logger.warning("Assistant index not loaded: %s", _load_error)
        return None

    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))

        if meta.get("format_version") != INDEX_FORMAT_VERSION:
            _load_error = (
                "The index was built with an older format. Rebuild it with "
                "`python scripts/build_faiss_index.py`."
            )
            logger.error("Index not loaded: %s", _load_error)
            return None

        settings = get_settings()
        if meta.get("embedding_model") != settings.gemini_embedding_model:
            # Vectors from a different model are not comparable with query vectors
            # from this one. Serving this would return confident nonsense.
            _load_error = (
                f"The index was built with embedding model "
                f"'{meta.get('embedding_model')}' but the app is configured for "
                f"'{settings.gemini_embedding_model}'. Rebuild the index."
            )
            logger.error("Index not loaded: %s", _load_error)
            return None

        vectors = faiss.deserialize_index(np.frombuffer(index_path.read_bytes(), dtype=np.uint8))

        chunks = meta.get("chunks", [])
        if vectors.ntotal != len(chunks):
            _load_error = (
                f"Index holds {vectors.ntotal} vectors but the metadata holds "
                f"{len(chunks)} chunks. Rebuild the index."
            )
            logger.error("Index not loaded: %s", _load_error)
            return None

        _state = LoadedIndex(
            chunks=chunks,
            vectors=vectors,
            embedding_model=meta.get("embedding_model", ""),
            dimension=int(meta.get("dimension", 0)),
            built_at=meta.get("built_at", ""),
            source_files=meta.get("source_files", []),
        )
        _load_error = None
        logger.info(
            "Assistant index loaded: %d chunks, %d dims, built %s",
            _state.chunk_count,
            _state.dimension,
            _state.built_at,
        )
        return _state

    except Exception as exc:  # noqa: BLE001 - a bad index must not kill startup
        _load_error = f"Could not load the assistant index: {exc}"
        logger.exception("Index load failed")
        return None


def unload_index() -> None:
    """Drop the loaded index (used by tests)."""
    global _state, _load_error
    _state = None
    _load_error = None


def build_and_persist(
    documents: list[tuple[str, str]],
    *,
    chunk_size: int,
    chunk_overlap: int,
) -> LoadedIndex:
    """Chunk, embed and persist the knowledge base.

    `documents` is a list of `(source_name, text)` pairs. Embedding is done in
    batches by `GeminiEmbedding`.

    Chunking is heading-aware: the corpus is Markdown organised by `##` sections,
    and splitting on those boundaries keeps a disease's symptoms with its
    management advice instead of cutting across them.
    """
    import faiss
    import numpy as np

    from app.rag.embeddings import get_embed_model

    settings = get_settings()
    directory = index_directory()
    directory.mkdir(parents=True, exist_ok=True)

    chunks = _chunk_documents(documents, chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    if not chunks:
        raise ValueError("No chunks were produced from the knowledge base.")

    logger.info("Embedding %d chunks…", len(chunks))
    embed_model = get_embed_model()
    vectors = embed_model._embed([c["text"] for c in chunks])

    dimension = len(vectors[0])
    logger.info("Embedded %d chunks at %d dimensions", len(vectors), dimension)

    array = np.asarray(vectors, dtype="float32")
    # Gemini embeddings are unit-normalised, so inner product == cosine similarity.
    faiss_index = faiss.IndexFlatIP(dimension)
    faiss_index.add(array)

    meta = {
        "format_version": INDEX_FORMAT_VERSION,
        "embedding_model": settings.gemini_embedding_model,
        "dimension": dimension,
        "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "chunk_size": chunk_size,
        "chunk_overlap": chunk_overlap,
        "source_files": sorted({c["source"] for c in chunks}),
        "chunks": chunks,
    }

    index_path = directory / INDEX_FILENAME
    meta_path = directory / META_FILENAME
    index_path.write_bytes(bytes(faiss.serialize_index(faiss_index)))
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

    logger.info("Wrote %s (%d bytes)", index_path, index_path.stat().st_size)

    return LoadedIndex(
        chunks=chunks,
        vectors=faiss_index,
        embedding_model=settings.gemini_embedding_model,
        dimension=dimension,
        built_at=meta["built_at"],
        source_files=meta["source_files"],
    )


def _chunk_documents(
    documents: list[tuple[str, str]], *, chunk_size: int, chunk_overlap: int
) -> list[dict]:
    """Split documents into heading-aligned chunks.

    Long sections are further split with a character budget, carrying a small
    overlap so a sentence spanning the boundary is still retrievable.
    """
    chunks: list[dict] = []

    for source, text in documents:
        sections = _split_on_headings(text)
        for heading, body in sections:
            body = body.strip()
            if not body:
                continue
            for piece in _split_with_overlap(body, chunk_size, chunk_overlap):
                chunks.append(
                    {
                        "text": f"{heading}\n\n{piece}" if heading else piece,
                        "source": source,
                        "heading": heading,
                    }
                )

    for i, chunk in enumerate(chunks):
        chunk["index"] = i

    return chunks


def _split_on_headings(text: str) -> list[tuple[str, str]]:
    """Split Markdown into (heading, body) sections on `##`/`###` boundaries."""
    lines = text.splitlines()
    sections: list[tuple[str, str]] = []
    heading = ""
    buffer: list[str] = []

    for line in lines:
        if line.startswith("## ") or line.startswith("### "):
            if buffer and any(line.strip() for line in buffer):
                sections.append((heading, "\n".join(buffer)))
            heading = line.lstrip("#").strip()
            buffer = []
        elif line.startswith("# "):
            # Document title — not useful as a chunk heading on its own.
            continue
        else:
            buffer.append(line)

    if buffer and any(line.strip() for line in buffer):
        sections.append((heading, "\n".join(buffer)))

    return sections


def _split_with_overlap(text: str, chunk_size: int, overlap: int) -> list[str]:
    """Character-budget split that prefers to break on a paragraph boundary."""
    if len(text) <= chunk_size:
        return [text]

    pieces: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        if end < len(text):
            # Prefer a paragraph break, then a sentence, then a hard cut.
            for separator in ("\n\n", ". ", "\n"):
                cut = text.rfind(separator, start + chunk_size // 2, end)
                if cut != -1:
                    end = cut + len(separator)
                    break
        pieces.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)

    return [p for p in pieces if p]
