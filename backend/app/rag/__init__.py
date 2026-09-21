"""RAG farming assistant: LlamaIndex retrieval + FAISS + Gemini generation.

STRICT BOUNDARY: this package must never perform image diagnosis and must never
import the PyTorch detection model in `app.models`. Answers are always grounded
in retrieved knowledge-base chunks — never free-generated.

Filled in during **Phase 6**:
  * `index.py`      — load the persisted FAISS index at API startup
  * `retriever.py`  — similarity search over the curated knowledge base
  * `llm.py`        — `generate_answer(context, question)` provider abstraction
                      so Gemini can be swapped without touching the pipeline
"""
