"""Offline: build and persist the FAISS index for the RAG farming assistant.

Never run by the API. The API only *loads* what this produces
(`app/rag/index.py`, called from the lifespan handler).

    python scripts/build_faiss_index.py
    python scripts/build_faiss_index.py --dry-run     # chunk only, no API calls

`--dry-run` checks the chunking before spending embedding quota.

The corpus is `app/knowledge_base/documents/*.md` — curated guidance traced to
ICAR, KVK and agricultural university sources. Nothing else is indexed: the
assistant can only answer from what is in here, which is the point.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402
from app.rag.index import (  # noqa: E402
    INDEX_FILENAME,
    META_FILENAME,
    _chunk_documents,
    build_and_persist,
    index_directory,
)

DOCUMENTS_DIR = Path(__file__).resolve().parents[1] / "app" / "knowledge_base" / "documents"


def load_documents() -> list[tuple[str, str]]:
    """Read the curated Markdown documents as (source_name, text) pairs."""
    if not DOCUMENTS_DIR.exists():
        print(f"Knowledge base directory not found: {DOCUMENTS_DIR}")
        return []

    documents: list[tuple[str, str]] = []
    for path in sorted(DOCUMENTS_DIR.glob("*.md")):
        text = path.read_text(encoding="utf-8").strip()
        if text:
            documents.append((path.stem, text))
    return documents


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the Agri AI assistant FAISS index")
    parser.add_argument("--dry-run", action="store_true", help="chunk only; make no API calls")
    args = parser.parse_args()

    settings = get_settings()
    print("=" * 74)
    print("Agri AI — building the assistant knowledge index")
    print("=" * 74)

    documents = load_documents()
    if not documents:
        print("No documents to index.")
        return 2

    print(f"\nDocuments ({len(documents)}):")
    total_chars = 0
    for name, text in documents:
        total_chars += len(text)
        print(f"  {name:<34} {len(text):>7,} chars")
    print(f"  {'TOTAL':<34} {total_chars:>7,} chars")

    if args.dry_run:
        chunks = _chunk_documents(
            documents,
            chunk_size=settings.rag_chunk_size,
            chunk_overlap=settings.rag_chunk_overlap,
        )
        print(f"\nDry run — {len(chunks)} chunks would be created:")
        by_source: dict[str, int] = {}
        for chunk in chunks:
            by_source[chunk["source"]] = by_source.get(chunk["source"], 0) + 1
        for source, count in sorted(by_source.items()):
            print(f"  {source:<34} {count:>4} chunks")
        sizes = [len(c["text"]) for c in chunks]
        print(f"\n  chunk size: min={min(sizes)} avg={sum(sizes) // len(sizes)} max={max(sizes)}")
        print(f"\n  sample chunk:\n    {chunks[0]['text'][:200].replace(chr(10), ' ')}…")
        return 0

    if not settings.gemini_api_key:
        print("\nGEMINI_API_KEY is not set — cannot embed. Use --dry-run to check chunking.")
        return 2

    print(
        f"\nEmbedding with {settings.gemini_embedding_model} "
        f"(chunk_size={settings.rag_chunk_size}, overlap={settings.rag_chunk_overlap})"
    )

    try:
        loaded = build_and_persist(
            documents,
            chunk_size=settings.rag_chunk_size,
            chunk_overlap=settings.rag_chunk_overlap,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"\nBuild failed: {exc}")
        return 1

    directory = index_directory()
    print("\nIndex built:")
    print(f"  chunks          {loaded.chunk_count}")
    print(f"  dimensions      {loaded.dimension}")
    print(f"  embedding model {loaded.embedding_model}")
    print(f"  built at        {loaded.built_at}")
    print(f"  written to      {directory / INDEX_FILENAME}")
    print(f"                  {directory / META_FILENAME}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
