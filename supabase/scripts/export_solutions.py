"""Export the curated `solutions` table for agronomist review.

The `solutions` table is the product's trust foundation — the LLM is never allowed
to invent guidance, so every row a farmer sees comes from here. The rows are
traced to named institutional sources, but **that is not the same as agronomist
sign-off**, and `DECISIONS.md` records that review as the biggest remaining
pre-launch risk.

There was no artifact to hand a reviewer. This produces two:

  docs/solutions-review.csv    one row per solution, with blank verdict columns
                               for tracking in a spreadsheet
  docs/solutions-review.html   the same content grouped by disease, formatted to
                               print or save as PDF

Both are generated from the *live* database built from the migrations, not parsed
out of the SQL text — so the export fails loudly if a migration stops applying.

Usage (needs the dbcheck venv — `pgserver` + `psycopg2` are test-only deps):

    ~/.workbuddy-ai/binaries/python/envs/agri-ai-dbcheck/Scripts/python.exe \
        supabase/scripts/export_solutions.py
"""

from __future__ import annotations

import csv
import html
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "supabase" / "tests"))

import run_db_tests as harness  # noqa: E402  (path set up above)

OUT_DIR = REPO_ROOT / "docs" / "solutions-review"

COLUMNS = [
    "disease_name",
    "solution_type",
    "title",
    "description",
    "source_name",
    "source_url",
    "region_specific",
    "verified",
]

# Columns the reviewer fills in. Kept empty in the export.
REVIEW_COLUMNS = ["verdict", "reviewer", "reviewed_on", "notes"]

VERDICTS = "approve | amend | remove"


def fetch_solutions() -> list[dict]:
    """Build the database from migrations and read the table back."""
    import psycopg2
    import pgserver

    harness.PGDATA.mkdir(parents=True, exist_ok=True)
    db = pgserver.get_server(str(harness.PGDATA))
    try:
        conn = psycopg2.connect(db.get_uri())
        conn.autocommit = False
        harness.build_database(conn)

        with conn.cursor() as cur:
            cur.execute(
                f"select {', '.join(COLUMNS)} from public.solutions "
                "order by disease_name, solution_type, title"
            )
            rows = [dict(zip(COLUMNS, r, strict=True)) for r in cur.fetchall()]

        # Read-only: nothing here should be committed.
        conn.rollback()
        conn.close()
        return rows
    finally:
        db.cleanup()


def write_csv(rows: list[dict]) -> Path:
    path = OUT_DIR / "solutions-review.csv"
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=[*COLUMNS, *REVIEW_COLUMNS])
        writer.writeheader()
        for row in rows:
            writer.writerow({**row, **dict.fromkeys(REVIEW_COLUMNS, "")})
    return path


def write_html(rows: list[dict]) -> Path:
    by_disease: dict[str, list[dict]] = {}
    for row in rows:
        by_disease.setdefault(row["disease_name"], []).append(row)

    natural = sum(1 for r in rows if r["solution_type"] == "natural")
    traditional = len(rows) - natural
    verified = sum(1 for r in rows if r["verified"])

    def card(row: dict) -> str:
        kind = row["solution_type"]
        source = html.escape(row["source_name"] or "—")
        if row["source_url"]:
            source = (
                f'<a href="{html.escape(row["source_url"])}" '
                f'target="_blank" rel="noopener noreferrer">{source}</a>'
            )
        region = (
            f'<span class="tag">{html.escape(row["region_specific"])}</span>'
            if row["region_specific"]
            else ""
        )
        traced = (
            '<span class="tag ok">traced to source</span>'
            if row["verified"]
            else '<span class="tag warn">not traced</span>'
        )
        return f"""
        <article class="sol {kind}">
          <div class="sol-head">
            <span class="kind {kind}">{kind}</span>
            {traced}{region}
          </div>
          <h4>{html.escape(row["title"])}</h4>
          <p class="desc">{html.escape(row["description"])}</p>
          <p class="src">Source: {source}</p>
          <div class="verdict">
            <span class="box">Approve</span>
            <span class="box">Amend</span>
            <span class="box">Remove</span>
            <span class="rule">Notes:</span>
            <span class="line"></span>
          </div>
        </article>"""

    sections = "\n".join(
        f"""
        <section class="disease">
          <h2>{html.escape(name)} <span class="count">{len(items)} entries</span></h2>
          {''.join(card(r) for r in items)}
        </section>"""
        for name, items in by_disease.items()
    )

    doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Agri AI — solutions review sheet</title>
<style>
  :root {{
    --ink: #16161a; --muted: #5c5c66; --rule: #d9d9e0;
    --natural: #0f5132; --natural-bg: #e7f5ec;
    --traditional: #7a4a12; --traditional-bg: #fbf0e0;
    --warn: #8a1c1c;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; padding: 32px 28px 64px; background: #fff; color: var(--ink);
    font: 15px/1.6 -apple-system, "Segoe UI", Roboto, sans-serif;
    max-width: 900px; margin-inline: auto;
  }}
  h1 {{ font-size: 26px; margin: 0 0 6px; }}
  .lede {{ color: var(--muted); margin: 0 0 18px; }}
  .summary {{
    display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 26px;
    padding: 14px 16px; background: #f6f6f9; border: 1px solid var(--rule);
    border-radius: 10px; font-size: 14px;
  }}
  .summary b {{ font-variant-numeric: tabular-nums; }}
  .how {{ font-size: 14px; color: var(--muted); margin: 0 0 30px; }}
  .how strong {{ color: var(--ink); }}
  section.disease {{ margin: 0 0 34px; page-break-inside: avoid; }}
  h2 {{
    font-size: 18px; margin: 0 0 12px; padding-bottom: 8px;
    border-bottom: 2px solid var(--ink); display: flex;
    justify-content: space-between; align-items: baseline; gap: 12px;
  }}
  .count {{ font-size: 13px; font-weight: 400; color: var(--muted); }}
  .sol {{
    border: 1px solid var(--rule); border-left-width: 4px; border-radius: 8px;
    padding: 12px 14px; margin: 0 0 12px; page-break-inside: avoid;
  }}
  .sol.natural {{ border-left-color: var(--natural); }}
  .sol.traditional {{ border-left-color: var(--traditional); }}
  .sol-head {{ display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }}
  .kind {{
    font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .06em; padding: 2px 8px; border-radius: 999px;
  }}
  .kind.natural {{ background: var(--natural-bg); color: var(--natural); }}
  .kind.traditional {{ background: var(--traditional-bg); color: var(--traditional); }}
  .tag {{
    font-size: 11px; padding: 2px 8px; border-radius: 999px;
    background: #eeeef3; color: var(--muted);
  }}
  .tag.ok {{ background: var(--natural-bg); color: var(--natural); }}
  .tag.warn {{ background: #fbeaea; color: var(--warn); }}
  h4 {{ font-size: 15px; margin: 4px 0 6px; }}
  .desc {{ margin: 0 0 8px; }}
  .src {{ margin: 0 0 10px; font-size: 13px; color: var(--muted); }}
  .src a {{ color: #1a4fd6; }}
  .verdict {{
    display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
    padding-top: 10px; border-top: 1px dashed var(--rule); font-size: 13px;
  }}
  .box {{
    display: inline-flex; align-items: center; gap: 5px; color: var(--muted);
  }}
  .box::before {{
    content: ""; width: 13px; height: 13px; border: 1.5px solid #9a9aa6;
    border-radius: 3px; display: inline-block;
  }}
  .rule {{ margin-left: 8px; color: var(--muted); }}
  .line {{ flex: 1; min-width: 120px; border-bottom: 1px solid var(--rule); }}
  footer {{
    margin-top: 40px; padding-top: 14px; border-top: 1px solid var(--rule);
    font-size: 13px; color: var(--muted);
  }}
  @media print {{
    body {{ padding: 0; }}
    .box::before {{ border-color: #000; }}
  }}
</style>
</head>
<body>
  <h1>Agri AI — solutions review sheet</h1>
  <p class="lede">
    Every natural and traditional recommendation the app can show a farmer, for
    agronomist review before launch.
  </p>

  <div class="summary">
    <span><b>{len(rows)}</b> entries</span>
    <span>·</span>
    <span><b>{natural}</b> natural</span>
    <span>·</span>
    <span><b>{traditional}</b> traditional</span>
    <span>·</span>
    <span><b>{len(by_disease)}</b> disease classes</span>
    <span>·</span>
    <span><b>{verified}</b> traced to a named source</span>
  </div>

  <p class="how">
    <strong>What is being asked.</strong> These rows are the <em>only</em> source of
    natural and traditional guidance in the product — the language model is never
    allowed to invent advice, so anything wrong here reaches a farmer unchanged.
    Each row is traced to a named institutional source, but that is a
    <em>provenance</em> check, not an agronomic one. Please confirm the practice is
    sound, the dosage and timing are right, and nothing here could harm a crop or a
    person. Mark <strong>Approve</strong>, <strong>Amend</strong> (with the
    correction) or <strong>Remove</strong> for each.
  </p>

  {sections}

  <footer>
    Generated from the migrations by <code>supabase/scripts/export_solutions.py</code>.
    Rows marked <em>not traced</em> record recognised regional practice that is not
    tied to a specific institutional publication — these need the closest reading.
  </footer>
</body>
</html>"""

    path = OUT_DIR / "solutions-review.html"
    path.write_text(doc, encoding="utf-8")
    return path


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    rows = fetch_solutions()
    if not rows:
        print("No solutions found — did the migrations apply?")
        return 1

    csv_path = write_csv(rows)
    html_path = write_html(rows)

    # Keep the raw extract too, so the sheet can be regenerated without the DB.
    json_path = OUT_DIR / "solutions.json"
    json_path.write_text(
        json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    by_disease: dict[str, int] = {}
    for row in rows:
        by_disease[row["disease_name"]] = by_disease.get(row["disease_name"], 0) + 1

    print("=" * 74)
    print("Agri AI — solutions export")
    print("=" * 74)
    print(f"  {len(rows)} entries across {len(by_disease)} disease classes")
    for name, count in sorted(by_disease.items()):
        print(f"    {count:>3}  {name}")
    untraced = [r for r in rows if not r["verified"]]
    print(f"  {len(untraced)} entries are NOT traced to a named source")
    print("-" * 74)
    for path in (csv_path, html_path, json_path):
        print(f"  wrote {path.relative_to(REPO_ROOT)}")
    print("=" * 74)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
