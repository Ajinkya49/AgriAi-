# Trusted knowledge base — approved sources

Per the PRD product principles, the AI Farming Assistant must **never hallucinate
agricultural recommendations**. Every natural/traditional recommendation shown to
a farmer comes from the curated `solutions` table, and every assistant answer is
grounded in retrieved chunks from the documents listed here.

## Approved source categories

| Category | Examples | Used for |
|---|---|---|
| Government research bodies | ICAR (Indian Council of Agricultural Research) advisories | Disease management, IPM schedules |
| Krishi Vigyan Kendras (KVK) | KVK regional advisories, e.g. KVK Pune | Region-specific practice |
| Agricultural universities | State agricultural university extension bulletins | Crop-specific guidance |
| Government extension material | State agriculture department handbooks, package-of-practices | Sowing, nutrition, protection |

## Explicitly out of scope as sources

- Commercial input-dealer or pesticide-marketing material
- Unattributed blog / social media content
- Any LLM-generated text that is not traceable to a listed source

## Document layout

Drop the raw source documents into this folder (PDF / Markdown / plain text).
Phase 6's `scripts/build_faiss_index.py` chunks and embeds them.

> **Placeholder** — no source documents have been added yet. Phase 6 is when this
> folder is populated and the index is built. Until then the assistant reports
> itself as not configured.
