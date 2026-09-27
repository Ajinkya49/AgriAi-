"""Weather advisory feature (IMD data).

STRICT BOUNDARY, same as everywhere else in this codebase: nothing in this
package imports `app.rag` or `app.models`, and no LLM is consulted anywhere in
the weather pipeline. Advisories are deterministic rules over IMD data.

Layering:
  * `locations.py` — state → IMD station mapping (`users.region` is a state).
  * `imd.py`       — the HTTP client + cache + normalisation.
  * `advisory.py`  — pure functions: forecast → advisories.
"""
