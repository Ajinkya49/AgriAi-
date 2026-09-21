"""Measure production cold start and inference latency.

The Implementation Plan asks for this explicitly:

    "Verify production build of the model-serving path performs acceptably
     (cold start time, inference latency) under realistic conditions"

Run from anywhere; point `API` at the local backend or the deployed one:

    python scripts/measure_performance.py
    API=https://your-backend.onrender.com python scripts/measure_performance.py

The cold-start measurement spawns a fresh interpreter, which is what a container
start actually does — measuring it in-process would hide the cost.
"""

from __future__ import annotations

import io
import json
import os
import pathlib
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request

from PIL import Image

API = os.environ.get("API", "http://127.0.0.1:8000")
BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]

ENV: dict[str, str] = {}
env_file = BACKEND_DIR / ".env"
if env_file.exists():
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            ENV[k.strip()] = v.strip()


def sign_in(email: str) -> str:
    req = urllib.request.Request(
        f"{ENV['SUPABASE_URL']}/auth/v1/token?grant_type=password",
        data=json.dumps({"email": email, "password": "AgriAI#2026"}).encode(),
        method="POST",
        headers={"apikey": ENV["SUPABASE_ANON_KEY"], "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def leaf_bytes(size: int = 600) -> bytes:
    """A real leaf photo if the PlantVillage dataset is around, else synthetic.

    The size is representative of a phone upload, which is what the latency figure
    should reflect — not a 100x100 thumbnail.
    """
    dataset = pathlib.Path(
        os.environ.get(
            "PLANTVILLAGE_ROOT",
            "C:/Users/ajink/.workbuddy-ai/datasets/plantvillage/extracted/color",
        )
    )
    leaf_dir = dataset / "Tomato___Late_blight"
    files = sorted(leaf_dir.glob("*.jpg")) if leaf_dir.exists() else []
    if files:
        with Image.open(files[-1]) as im:
            buf = io.BytesIO()
            im.resize((size, int(size * 0.75))).convert("RGB").save(buf, format="JPEG", quality=85)
            return buf.getvalue()

    # No dataset — a flat image still exercises the full preprocess + forward path.
    buf = io.BytesIO()
    Image.new("RGB", (size, int(size * 0.75)), (70, 110, 60)).save(buf, format="JPEG")
    return buf.getvalue()


def diagnose(token: str, data: bytes) -> tuple[float, dict]:
    boundary = "----perf"
    body = (
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="leaf.jpg"\r\n'
            f"Content-Type: image/jpeg\r\n\r\n"
        ).encode()
        + data
        + f"\r\n--{boundary}--\r\n".encode()
    )

    req = urllib.request.Request(
        f"{API}/api/diagnose",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    started = time.perf_counter()
    with urllib.request.urlopen(req, timeout=120) as r:
        result = json.load(r)
    return time.perf_counter() - started, result


def main() -> int:
    print("=" * 74)
    print("Cold start — process import to model + index ready")
    print("=" * 74)

    # Measure a fresh interpreter importing the app and loading both artefacts, which
    # is what happens on every container start.
    probe = r"""
    import time
    t0 = time.perf_counter()
    import torch
    t_torch = time.perf_counter() - t0

    t0 = time.perf_counter()
    from app.models.loader import load_model
    model = load_model()
    t_model = time.perf_counter() - t0

    t0 = time.perf_counter()
    from app.rag.index import load_index
    index = load_index()
    t_index = time.perf_counter() - t0

    print(f"{t_torch:.2f},{t_model:.2f},{t_index:.2f},{model.num_classes if model else 0},{index.chunk_count if index else 0}")
    """

    started = time.perf_counter()
    proc = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
        timeout=300,
    )
    wall = time.perf_counter() - started

    if proc.returncode != 0:
        print("  FAILED:", proc.stderr.strip()[-400:])
    else:
        t_torch, t_model, t_index, classes, chunks = proc.stdout.strip().split(",")
        print(f"  import torch        {float(t_torch):>7.2f} s")
        print(f"  load model          {float(t_model):>7.2f} s   ({classes} classes)")
        print(f"  load FAISS index    {float(t_index):>7.2f} s   ({chunks} chunks)")
        print("  -------------------------------")
        print(f"  TOTAL wall clock    {wall:>7.2f} s")

    print()
    print("=" * 74)
    print("Inference latency — POST /api/diagnose")
    print("=" * 74)

    token = sign_in("ramesh.patil@example.com")
    data = leaf_bytes()

    # One warm-up so we measure steady state, not the first-request penalty.
    warm, _ = diagnose(token, data)
    print(f"  warm-up request     {warm:>7.2f} s")

    samples: list[float] = []
    for _ in range(10):
        elapsed, result = diagnose(token, data)
        samples.append(elapsed)

    samples.sort()
    print(f"  requests            {len(samples)}")
    print(f"  min                 {min(samples):>7.2f} s")
    print(f"  median (p50)        {statistics.median(samples):>7.2f} s")
    print(f"  mean                {statistics.mean(samples):>7.2f} s")
    print(f"  p95                 {samples[int(len(samples) * 0.95) - 1]:>7.2f} s")
    print(f"  max                 {max(samples):>7.2f} s")
    print(f"  predicted           {result['predicted_disease']} ({result['confidence_score']:.3f})")

    print()
    print("=" * 74)
    print("Assistant latency — retrieval + Gemini generation")
    print("=" * 74)

    def ask(question: str) -> tuple[float, dict]:
        req = urllib.request.Request(
            f"{API}/api/assistant/message",
            data=json.dumps({"message": question}).encode(),
            method="POST",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return time.perf_counter() - started, json.load(r)
        except urllib.error.HTTPError as e:
            return time.perf_counter() - started, {"error": e.code}

    for question in ["How do I make panchagavya?", "When should I water my tomato crop?"]:
        elapsed, result = ask(question)
        if "error" in result:
            print(f"  {question[:38]:<40} {elapsed:>6.2f} s  (HTTP {result['error']})")
        else:
            print(
                f"  {question[:38]:<40} {elapsed:>6.2f} s  "
                f"model={result['model']} sources={len(result['sources'])}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
