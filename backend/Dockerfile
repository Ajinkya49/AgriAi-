# Agri AI — backend image (FastAPI + PyTorch + FAISS)
#
# CPU-only on purpose: the TRD assumes no GPU at MVP, and the CPU torch wheel is
# roughly 500 MB instead of the ~2.5 GB CUDA build. Both ML artefacts are baked
# into the image so the container never downloads or rebuilds them at runtime:
#
#     app/models/weights/efficientnet_b0_agri.pt    the fine-tuned classifier
#     app/rag/index/knowledge_base.faiss + .meta.json   the assistant index
#
# Build from the REPOSITORY ROOT so both apps share one context:
#     docker build -f backend/Dockerfile -t agri-ai-backend .
#
# Measured cold start on 12 CPU cores: ~8.5 s (3.4 s importing torch, 3.3 s
# loading the model, 0.2 s loading the index).

FROM python:3.13-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libgomp1 is needed by torch's CPU kernels; the rest is for Pillow.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgomp1 \
        libjpeg62-turbo \
        zlib1g \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---- Dependencies (cached separately from the source) ----------------------
COPY backend/requirements.txt ./
# torch/torchvision come from PyTorch's own index — the default PyPI wheels are
# the multi-GB CUDA builds.
RUN pip install --extra-index-url https://download.pytorch.org/whl/cpu \
        -r requirements.txt

# ---- Application ----------------------------------------------------------
COPY backend/app ./app
COPY backend/scripts ./scripts

# Fail the build rather than shipping an image that cannot serve. A missing model
# would make /api/diagnose return 503 in production with no obvious cause.
RUN python -c "\
import pathlib, sys; \
missing = [p for p in [ \
    'app/models/weights/efficientnet_b0_agri.pt', \
    'app/rag/index/knowledge_base.faiss', \
    'app/rag/index/knowledge_base.meta.json', \
] if not pathlib.Path(p).exists()]; \
print('MISSING ARTEFACTS:', missing) if missing else print('artefacts present'); \
sys.exit(1 if missing else 0)"

# ---- Runtime --------------------------------------------------------------
# Run as a non-root user. The app writes nothing to disk at runtime — the model
# and index are read-only and uploads go to Supabase Storage.
RUN useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Render/Railway set $PORT. Default to 8000 for local `docker run`.
ENV PORT=8000

# Matches /api/health, which is deliberately dependency-free so a platform health
# check does not fail because Supabase or Gemini is briefly unavailable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

# One worker on purpose: the model is ~16 MB and inference is CPU-bound, so extra
# workers multiply memory without adding throughput on a small instance. Scale the
# instance, not the worker count, unless you have measured otherwise.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
