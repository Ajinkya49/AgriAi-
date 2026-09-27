"""The crop picker and the model's real scope must agree.

Guards a bug that shipped once and would have been invisible to every other test:

    The picker offered 12 crops. The model could diagnose 3.
    `Pepper` was diagnosable but missing from the picker entirely.

A farmer growing Rice could declare it, photograph a leaf, and receive a
confident-looking answer for whichever of the 10 trained classes scored highest —
because a classifier with a fixed output layer has no way to say "not one of
mine". Nothing errored. Nothing logged. The result just looked authoritative and
was wrong.

Two invariants are enforced here, both statically (fast, offline, no browser):

1. **`DIAGNOSABLE_CROPS` is derived, not hand-listed.** It must equal the set of
   `crop_type` values in the taxonomy, so it cannot drift from the trained
   checkpoint.
2. **The frontend picker offers every diagnosable crop.** If the model learns a
   new crop and the picker is not updated, this fails rather than shipping a
   crop nobody can select.

The frontend list is parsed from source rather than duplicated here, so this test
compares the two real definitions. The live equivalent is served at
`GET /api/health/dependencies` → `model.diagnosable_crops`.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.models.labels import (
    DIAGNOSABLE_CROPS,
    DISEASE_CLASSES,
    diseases_for_crop,
    is_diagnosable_crop,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
AUTH_TS = REPO_ROOT / "frontend" / "lib" / "validation" / "auth.ts"


def _ts_array(name: str) -> list[str]:
    """Read a `const NAME = ["A", "B"] as const;` array out of auth.ts.

    Parsed from source on purpose: importing TypeScript into pytest is not
    possible, and hardcoding a copy here would defeat the point — the test would
    then agree with itself while the real lists diverged.
    """
    text = AUTH_TS.read_text(encoding="utf-8")
    marker = f"{name} = ["
    assert marker in text, f"could not find `{name}` in {AUTH_TS}"
    body = text.split(marker, 1)[1].split("]", 1)[0]
    return re.findall(r'"([^"]+)"', body)


# ---------------------------------------------------------------------------
# Invariant 1 — DIAGNOSABLE_CROPS reflects the taxonomy
# ---------------------------------------------------------------------------


def test_diagnosable_crops_is_derived_from_the_taxonomy() -> None:
    """No hand-listed crops: it must be exactly what the classes declare."""
    expected = {c.crop_type for c in DISEASE_CLASSES}
    assert set(DIAGNOSABLE_CROPS) == expected, (
        "DIAGNOSABLE_CROPS has drifted from DISEASE_CLASSES.\n"
        f"  taxonomy : {sorted(expected)}\n"
        f"  declared : {sorted(DIAGNOSABLE_CROPS)}"
    )


def test_diagnosable_crops_has_no_duplicates() -> None:
    """Several classes share a crop, so deduplication must have happened."""
    assert len(DIAGNOSABLE_CROPS) == len(set(DIAGNOSABLE_CROPS))


def test_every_diagnosable_crop_has_a_disease_class() -> None:
    """A crop that is 'supported' but has only a Healthy class is not useful.

    Healthy-only would mean the model can say "looks fine" and nothing else,
    which is a misleading thing to advertise as photo checking.
    """
    for crop in DIAGNOSABLE_CROPS:
        classes = diseases_for_crop(crop)
        assert classes, f"{crop} is listed as diagnosable but has no classes"

        non_healthy = [c for c in classes if c.display_name != "Healthy"]
        assert non_healthy, (
            f"{crop} has no disease classes — only 'Healthy'. It cannot be "
            "advertised as diagnosable, because the model could never name a "
            "disease for it."
        )


# ---------------------------------------------------------------------------
# Invariant 2 — the picker offers everything the model can diagnose
# ---------------------------------------------------------------------------


def test_frontend_picker_offers_every_diagnosable_crop() -> None:
    """The Pepper bug, as a test.

    If the model learns a crop the picker does not offer, a farmer cannot declare
    it — and the profile silently misrepresents what they grow.
    """
    offered = {c.lower() for c in _ts_array("CROP_OPTIONS")}
    missing = [c for c in DIAGNOSABLE_CROPS if c.lower() not in offered]

    assert not missing, (
        "The model can diagnose crops the picker does not offer: "
        f"{missing}.\n"
        f"  diagnosable : {sorted(DIAGNOSABLE_CROPS)}\n"
        f"  offered     : {sorted(offered)}\n"
        "Add them to CROP_OPTIONS in frontend/lib/validation/auth.ts."
    )


def test_frontend_diagnosable_list_matches_the_backend() -> None:
    """The frontend's DIAGNOSABLE_CROPS is a deliberate duplicate.

    It has to be — the picker is a client component and the taxonomy is not
    importable from the browser. A duplicate that is not checked is a future
    inconsistency, so it is checked here.
    """
    frontend = {c.lower() for c in _ts_array("DIAGNOSABLE_CROPS")}
    backend = {c.lower() for c in DIAGNOSABLE_CROPS}

    assert frontend == backend, (
        "frontend DIAGNOSABLE_CROPS disagrees with the backend.\n"
        f"  backend  : {sorted(backend)}\n"
        f"  frontend : {sorted(frontend)}\n"
        "Update frontend/lib/validation/auth.ts to match labels.py."
    )


def test_frontend_picker_is_broader_than_the_model() -> None:
    """Deliberate: farmers declare what they grow, not what v1 can diagnose.

    This asserts the design intent rather than a bug — if the two ever become
    identical, the profile stops reflecting reality and this test should be
    reconsidered rather than silently deleted.
    """
    offered = {c.lower() for c in _ts_array("CROP_OPTIONS")}
    diagnosable = {c.lower() for c in DIAGNOSABLE_CROPS}

    assert offered > diagnosable, (
        "CROP_OPTIONS should be a superset of DIAGNOSABLE_CROPS. "
        f"offered={sorted(offered)} diagnosable={sorted(diagnosable)}"
    )


# ---------------------------------------------------------------------------
# The helpers the UI relies on
# ---------------------------------------------------------------------------


def test_is_diagnosable_crop_is_case_insensitive() -> None:
    """`users.primary_crops` is free text, so casing cannot be trusted."""
    assert is_diagnosable_crop("Tomato")
    assert is_diagnosable_crop("tomato")
    assert is_diagnosable_crop("  TOMATO  ")


def test_is_diagnosable_crop_rejects_unsupported_crops() -> None:
    """These are offered in the picker but the model cannot diagnose them."""
    for crop in ("Wheat", "Rice", "Cotton", "Maize", "Onion"):
        assert not is_diagnosable_crop(crop), f"{crop} should not be diagnosable"


def test_is_diagnosable_crop_handles_empty_input() -> None:
    assert not is_diagnosable_crop("")
    assert not is_diagnosable_crop("   ")
