"""Solution matching against the curated knowledge base.

**This module is the only source of Natural and Traditional guidance.** The LLM
is never allowed to produce a solution, and nothing here generates text — it
reads rows from the `solutions` table, which is populated by
`supabase/migrations/20260915000004_solutions_knowledge_base.sql` and is
writable only by an admin.

Matching is on `disease_name`, which must equal `diagnoses.predicted_disease`
exactly. There is deliberately no fuzzy or substring matching: a near-miss would
attach advice for one disease to another, which is worse than showing nothing.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.core.logging import get_logger

logger = get_logger(__name__)

NATURAL = "natural"
TRADITIONAL = "traditional"


@dataclass(frozen=True)
class Solution:
    id: str
    solution_type: str
    title: str
    description: str
    source_name: str
    source_url: str | None
    region_specific: str | None
    verified: bool


@dataclass(frozen=True)
class SolutionsForDisease:
    """The two sections the diagnosis screen renders."""

    natural: tuple[Solution, ...]
    traditional: tuple[Solution, ...]

    @property
    def total(self) -> int:
        return len(self.natural) + len(self.traditional)

    @property
    def is_empty(self) -> bool:
        return self.total == 0

    @property
    def is_complete(self) -> bool:
        """True when both sections have something to show."""
        return bool(self.natural) and bool(self.traditional)


def _row_to_solution(row: dict[str, Any]) -> Solution:
    return Solution(
        id=str(row["id"]),
        solution_type=row["solution_type"],
        title=row["title"],
        description=row["description"],
        source_name=row["source_name"],
        source_url=row.get("source_url"),
        region_specific=row.get("region_specific"),
        verified=bool(row.get("verified")),
    )


def _sort_key(solution: Solution) -> tuple:
    """Verified entries first, then alphabetically — stable and predictable."""
    return (not solution.verified, solution.title.lower())


def group(rows: list[dict[str, Any]]) -> SolutionsForDisease:
    """Split raw `solutions` rows into the Natural and Traditional sections."""
    natural: list[Solution] = []
    traditional: list[Solution] = []

    for row in rows:
        solution = _row_to_solution(row)
        if solution.solution_type == NATURAL:
            natural.append(solution)
        elif solution.solution_type == TRADITIONAL:
            traditional.append(solution)
        else:
            # The column has a CHECK constraint, so this is unreachable unless the
            # constraint is dropped. Log rather than silently drop the row.
            logger.warning(
                "Unknown solution_type %r on solution %s", solution.solution_type, solution.id
            )

    natural.sort(key=_sort_key)
    traditional.sort(key=_sort_key)
    return SolutionsForDisease(natural=tuple(natural), traditional=tuple(traditional))


def fetch_for_disease(client: Any, disease_name: str) -> SolutionsForDisease:
    """Load the curated solutions for one disease.

    `client` must already carry the caller's identity so RLS applies. Returns an
    empty group rather than raising — a missing knowledge-base entry should show
    an honest "not available yet" state, not a 500.
    """
    if not disease_name:
        return SolutionsForDisease(natural=(), traditional=())

    try:
        result = client.table("solutions").select("*").eq("disease_name", disease_name).execute()
    except Exception:  # noqa: BLE001 - never break a diagnosis over a lookup
        logger.exception("Could not load solutions for %r", disease_name)
        return SolutionsForDisease(natural=(), traditional=())

    rows = result.data or []
    grouped = group(rows)

    if grouped.is_empty:
        # Worth surfacing: the product promises a diagnosis never comes back with
        # no guidance attached, so a gap here is a knowledge-base defect.
        logger.warning("No curated solutions found for %r", disease_name)
    elif not grouped.is_complete:
        logger.warning(
            "Incomplete solutions for %r: %d natural, %d traditional",
            disease_name,
            len(grouped.natural),
            len(grouped.traditional),
        )

    return grouped
