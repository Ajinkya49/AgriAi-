# Offline scripts

Scripts in this folder are run **manually, offline** — they are never imported by
the running API. Per the TRD, the FAISS index and the model weights are produced
here and then merely *loaded* at API startup.

| Script | Phase | Purpose |
|---|---|---|
| `build_faiss_index.py` | 6 | Chunk + embed the trusted knowledge base and persist the FAISS index to `app/rag/index/`. |
| `train_model.py` | 4 | Fine-tune EfficientNet-B0 on PlantVillage + PlantDoc for the initial curated crop/disease set. |

Both are placeholders in Phase 1 — they exist so the repo structure matches the
TRD folder layout, and are implemented in their respective phases.

## Running

```bash
cd backend
.venv/Scripts/activate        # Windows
python scripts/build_faiss_index.py
python scripts/train_model.py
```
