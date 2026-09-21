"""Time the assistant end to end, and show where the time goes.

The fallback chain is what makes the free tier usable, but it is also what makes a
bad day slow: every rate-limited model costs a full backoff cycle before the chain
moves on. This measures the real distribution so the retry policy can be set from
evidence rather than guesswork.

Usage: python scripts/time_assistant.py [n]
"""

from __future__ import annotations

import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.rag.index import load_index  # noqa: E402
from app.rag.pipeline import answer_question  # noqa: E402

QUESTIONS = [
    "How do I stop late blight from spreading?",
    "How much should I water my tomato crop?",
    "लेट ब्लाइट को फैलने से कैसे रोकूँ?",
    "How do I make panchagavya?",
    "Why do my plants keep getting fungal disease every season?",
]


def main() -> int:
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    load_index()

    timings: list[float] = []
    print(f"timing {count} question(s)\n")
    for i in range(count):
        question = QUESTIONS[i % len(QUESTIONS)]
        started = time.perf_counter()
        try:
            answer = answer_question(question)
            elapsed = time.perf_counter() - started
            timings.append(elapsed)
            print(f"  {elapsed:6.2f}s  {answer.model or '(refused, no model)':<44} {question[:34]}")
        except Exception as exc:  # noqa: BLE001
            elapsed = time.perf_counter() - started
            timings.append(elapsed)
            print(f"  {elapsed:6.2f}s  ERROR {type(exc).__name__}: {str(exc)[:60]}")

    if timings:
        print()
        print(
            f"  n={len(timings)}  min={min(timings):.2f}s  "
            f"median={statistics.median(timings):.2f}s  max={max(timings):.2f}s"
        )
        over = [t for t in timings if t > 20]
        if over:
            print(f"  ⚠️  {len(over)} of {len(timings)} took longer than 20s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
