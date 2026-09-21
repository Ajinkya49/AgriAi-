"""Phase 5 — the curated knowledge base must cover every diagnosable class.

The product promise is that a diagnosis never comes back without guidance:

    "every diagnosis in the test set returns matched, correctly labeled Natural
     and Traditional solutions — never an empty or hallucinated result"

That invariant is enforced here, statically, by reading the solutions migration.
Adding a class to `labels.py` without adding solutions for it therefore fails the
test suite rather than silently shipping a dead end to a farmer.

Reading the SQL rather than the database keeps this fast and offline. Live
end-to-end coverage is checked by `supabase/tests/verify_live_project.py` and
`frontend/e2e/diagnosis-flow.mjs`.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.models.labels import DISEASE_CLASSES

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATION = REPO_ROOT / "supabase" / "migrations" / "20260915000004_solutions_knowledge_base.sql"

# Each inserted row starts on its own line: ('<disease>', '<type>', ... ), or );
ROW_START = re.compile(r"^\(\s*'([^']+)'\s*,\s*'(natural|traditional)'\s*,", re.MULTILINE)


def _migration_text() -> str:
    assert MIGRATION.exists(), f"missing knowledge base migration: {MIGRATION}"
    return MIGRATION.read_text(encoding="utf-8")


def _row_bodies() -> list[tuple[str, str, str]]:
    """Split the migration into (disease, type, body) per inserted row.

    `body` is everything after the first two columns, which is what the
    source/verified checks need.
    """
    text = _migration_text()
    matches = list(ROW_START.finditer(text))
    rows: list[tuple[str, str, str]] = []
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        rows.append((match.group(1), match.group(2), text[match.end() : end]))
    return rows


@pytest.fixture(scope="module")
def rows() -> list[tuple[str, str, str]]:
    return _row_bodies()


def test_migration_defines_solutions(rows: list[tuple[str, str, str]]) -> None:
    assert len(rows) >= 30, f"only {len(rows)} solutions defined"


def test_every_class_has_both_sections(rows: list[tuple[str, str, str]]) -> None:
    """Every diagnosable class needs at least one Natural AND one Traditional entry."""
    by_disease: dict[str, set[str]] = {}
    for disease, kind, _ in rows:
        by_disease.setdefault(disease, set()).add(kind)

    missing: list[str] = []
    for cls in DISEASE_CLASSES:
        kinds = by_disease.get(cls.disease_name, set())
        gaps = {"natural", "traditional"} - kinds
        if gaps:
            missing.append(f"{cls.disease_name} (missing: {', '.join(sorted(gaps))})")

    assert not missing, "classes without full solution coverage:\n  " + "\n  ".join(missing)


def test_no_orphan_solutions(rows: list[tuple[str, str, str]]) -> None:
    """No solution may reference a disease the model cannot predict.

    An orphan would never be shown, and usually means a class was renamed on one
    side only — exactly the drift the exact-match rule is meant to catch.
    """
    known = {cls.disease_name for cls in DISEASE_CLASSES}
    orphans = sorted({disease for disease, _, _ in rows} - known)
    assert not orphans, f"solutions reference unknown diseases: {orphans}"


def test_taxonomy_format_is_consistent(rows: list[tuple[str, str, str]]) -> None:
    """`<Crop> - <Disease>` — the format the whole matching scheme depends on."""
    bad = [disease for disease, _, _ in rows if " - " not in disease]
    assert not bad, f"disease_name is not '<Crop> - <Disease>': {bad}"


def test_traditional_rows_are_sourced_or_explicitly_unverified(
    rows: list[tuple[str, str, str]],
) -> None:
    """A traditional entry must cite a source, or be marked unverified.

    Traditional knowledge is never presented as a guaranteed treatment. A row
    that neither cites a source nor declares itself unverified would be presented
    with the same confidence as sourced guidance — which is the failure mode this
    guards against.
    """
    problems: list[str] = []
    for disease, kind, body in rows:
        if kind != "traditional":
            continue
        cites_source = "http" in body
        explicitly_unverified = re.search(r"null\s*,\s*false", body) is not None
        if not cites_source and not explicitly_unverified:
            problems.append(disease)

    assert not problems, (
        "traditional rows that neither cite a source nor set verified=false: "
        f"{sorted(set(problems))}"
    )


def test_natural_rows_cite_a_source(rows: list[tuple[str, str, str]]) -> None:
    """Natural guidance is the more authoritative category — it always cites."""
    missing = [disease for disease, kind, body in rows if kind == "natural" and "http" not in body]
    assert not missing, f"natural rows with no source URL: {sorted(set(missing))}"


def test_descriptions_are_substantive(rows: list[tuple[str, str, str]]) -> None:
    """Guard against placeholder one-liners creeping into the knowledge base."""
    short: list[str] = []
    for disease, _, body in rows:
        # The description is the second quoted string after the type.
        strings = re.findall(r"'((?:[^']|'')*)'", body)
        description = strings[1] if len(strings) > 1 else ""
        if len(description) < 80:
            short.append(f"{disease} ({len(description)} chars)")

    assert not short, "descriptions too short to be useful:\n  " + "\n  ".join(short)
