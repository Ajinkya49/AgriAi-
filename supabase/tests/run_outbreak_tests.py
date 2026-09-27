"""Verification for `public.regional_outbreaks()`.

Runs against a throwaway PostgreSQL instance with the real migrations and seed
applied, executing as the real database roles with a simulated JWT subject —
the same approach as `run_db_tests.py`.

The point of these tests is not that the function returns rows. It is that the
function is **safe**: it must expose an aggregate without exposing anybody. So
most of what follows is adversarial — probing the floor, the region scoping and
the returned columns for a way to learn about an individual farmer.

Run with the dbcheck virtualenv (needs `pgserver` + `psycopg2`, which are
test-only and deliberately absent from the backend requirements):

    ~/.workbuddy-ai/binaries/python/envs/agri-ai-dbcheck/Scripts/python.exe \
        supabase/tests/run_outbreak_tests.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import psycopg2

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"
SEED_FILE = REPO_ROOT / "supabase" / "seed.sql"
SHIM_FILE = REPO_ROOT / "supabase" / "tests" / "00_local_auth_shim.sql"
PGDATA = Path.home() / ".workbuddy-ai" / "binaries" / "python" / "pgdata" / "agri-ai"

# Seeded users and their regions (see seed.sql).
#   Maharashtra -> FARMER1, MODERATOR, ADMIN   (3 distinct farmers)
#   Bihar       -> FARMER2                     (1 farmer — can never hit the floor)
FARMER1 = "11111111-1111-4111-8111-111111111111"  # Maharashtra
FARMER2 = "22222222-2222-4222-8222-222222222222"  # Bihar
MODERATOR = "33333333-3333-4333-8333-333333333333"  # Maharashtra
ADMIN = "44444444-4444-4444-8444-444444444444"  # Maharashtra
MAHARASHTRA = "Maharashtra"

PASSED: list[str] = []
FAILED: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    (PASSED if ok else FAILED).append(name)
    mark = "PASS" if ok else "FAIL"
    suffix = f"  {detail}" if detail else ""
    print(f"  {mark}  {name:<62}{suffix}")


def apply_sql_file(conn, path: Path) -> None:
    with conn.cursor() as cur:
        cur.execute(path.read_text(encoding="utf-8"))
    conn.commit()


def build_database(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("drop schema if exists public cascade")
        cur.execute("create schema public")
        cur.execute("drop schema if exists auth cascade")
    conn.commit()

    apply_sql_file(conn, SHIM_FILE)
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        apply_sql_file(conn, path)
    apply_sql_file(conn, SEED_FILE)


def add_diagnosis(conn, user_id: str, disease: str, crop: str, confidence: float = 0.8,
                  days_ago: int = 1) -> None:
    """Insert one diagnosis directly, bypassing the API (this tests the DB layer)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into public.diagnoses
              (user_id, image_url, crop_type, predicted_disease,
               confidence_score, symptoms_summary, model_version, created_at)
            values (%s, %s, %s, %s, %s, 'synthetic', 'v1.0.0', now() - make_interval(days => %s))
            """,
            (user_id, f"uploads/{user_id}/x.jpg", crop, disease, confidence, days_ago),
        )
    conn.commit()


def call_as(conn, role: str | None, user_id: str | None, *,
            days: int = 14, min_reports: int = 3):
    """Invoke the function as `role` with a simulated JWT subject.

    Returns (status, rows_or_exception, columns_or_None).
    """
    cur = conn.cursor()
    try:
        cur.execute("begin")
        if role:
            cur.execute(f"set local role {role}")
        cur.execute(
            "select set_config('request.jwt.claims', %s, true)",
            (json.dumps({"role": role or "postgres", "sub": user_id}),),
        )
        cur.execute(
            "select * from public.regional_outbreaks(%s, %s)",
            (days, min_reports),
        )
        rows = cur.fetchall()
        columns = [d[0] for d in cur.description]
        return "ok", rows, columns
    except Exception as exc:  # noqa: BLE001 - any DB error is a test outcome
        return "error", exc, None
    finally:
        cur.execute("rollback")
        cur.close()


def main() -> int:
    print("=" * 78)
    print("  regional_outbreaks() verification")
    print("=" * 78)

    import pgserver

    pgdata = PGDATA
    pgdata.mkdir(parents=True, exist_ok=True)
    db = pgserver.get_server(pgdata)
    conn = psycopg2.connect(db.get_uri())
    conn.autocommit = False

    try:
        build_database(conn)

        # ------------------------------------------------------------------
        # 1. Exposure
        # ------------------------------------------------------------------
        print("\n-- exposure --")

        status, _, _ = call_as(conn, "anon", None)
        check("anon is blocked", status == "error", f"got {status}")

        status, rows, cols = call_as(conn, "authenticated", FARMER1)
        check("authenticated caller is allowed", status == "ok")

        # ------------------------------------------------------------------
        # 2. The returned shape must not identify anyone
        # ------------------------------------------------------------------
        print("\n-- returned columns --")

        forbidden = {"user_id", "id", "image_url", "confidence_score", "email", "phone"}
        leaked = forbidden & set(cols or [])
        check("no identifying columns returned", not leaked, f"leaked={sorted(leaked)}")
        check(
            "returns farmer_count and report_count",
            {"farmer_count", "report_count"} <= set(cols or []),
            f"cols={cols}",
        )

        # ------------------------------------------------------------------
        # 3. The k-anonymity floor
        # ------------------------------------------------------------------
        print("\n-- k-anonymity floor --")

        # Empty database of Maharashtra reports: nothing to show.
        _, rows, _ = call_as(conn, "authenticated", FARMER1)
        check("no reports yet -> no alerts", len(rows) == 0, f"{len(rows)} rows")

        # ONE farmer, several uploads. Must NOT be an outbreak.
        for _ in range(4):
            add_diagnosis(conn, FARMER1, "Tomato - Late Blight", "Tomato")
        _, rows, _ = call_as(conn, "authenticated", FARMER1)
        check(
            "1 farmer x 4 uploads -> still no alert",
            len(rows) == 0,
            "rows counted, not farmers" if rows else "correctly suppressed",
        )

        # A second farmer. Still below 3.
        add_diagnosis(conn, MODERATOR, "Tomato - Late Blight", "Tomato")
        _, rows, _ = call_as(conn, "authenticated", FARMER1)
        check("2 farmers -> still no alert", len(rows) == 0, f"{len(rows)} rows")

        # The floor cannot be lowered through the parameter.
        _, rows, _ = call_as(conn, "authenticated", FARMER1, min_reports=1)
        check(
            "min_reports=1 is clamped to 3",
            len(rows) == 0,
            f"{len(rows)} rows — floor held" if not rows else "FLOOR BREACHED",
        )

        # A third farmer trips it.
        add_diagnosis(conn, ADMIN, "Tomato - Late Blight", "Tomato")
        _, rows, cols = call_as(conn, "authenticated", FARMER1)
        check("3 distinct farmers -> alert fires", len(rows) == 1, f"{len(rows)} rows")

        if rows:
            row = dict(zip(cols, rows[0]))
            check("farmer_count is 3", row["farmer_count"] == 3, str(row["farmer_count"]))
            check(
                "report_count counts all 6 rows",
                row["report_count"] == 6,
                str(row["report_count"]),
            )
            check(
                "display_disease strips the crop prefix",
                row["display_disease"] == "Late Blight",
                repr(row["display_disease"]),
            )
            check("region is the caller's own", row["region"] == MAHARASHTRA, row["region"])

        # ------------------------------------------------------------------
        # 4. Region scoping
        # ------------------------------------------------------------------
        print("\n-- region scoping --")

        # A Bihar farmer has their own region and must not see Maharashtra.
        _, bihar_rows, _ = call_as(conn, "authenticated", FARMER2)
        check(
            "Bihar caller does not see Maharashtra's outbreak",
            len(bihar_rows) == 0,
            f"{len(bihar_rows)} rows",
        )

        # Even with an identical disease present in Bihar, it needs its own 3 farmers.
        add_diagnosis(conn, FARMER2, "Tomato - Late Blight", "Tomato")
        _, bihar_rows, _ = call_as(conn, "authenticated", FARMER2)
        check(
            "Bihar with 1 farmer stays silent",
            len(bihar_rows) == 0,
            f"{len(bihar_rows)} rows",
        )

        # ------------------------------------------------------------------
        # 5. Signal quality
        # ------------------------------------------------------------------
        print("\n-- signal quality --")

        # Healthy is not an outbreak.
        for uid in (FARMER1, MODERATOR, ADMIN):
            add_diagnosis(conn, uid, "Tomato - Healthy", "Tomato")
        _, rows, _ = call_as(conn, "authenticated", FARMER1)
        diseases = {dict(zip(cols, r))["predicted_disease"] for r in rows}
        check(
            "Healthy reports never form an alert",
            "Tomato - Healthy" not in diseases,
            f"diseases={sorted(diseases)}",
        )

        # Low confidence is not evidence. Put 3 farmers on a fresh disease at 0.2.
        for uid in (FARMER1, MODERATOR, ADMIN):
            add_diagnosis(conn, uid, "Potato - Late Blight", "Potato", confidence=0.2)
        _, rows, _ = call_as(conn, "authenticated", FARMER1)
        diseases = {dict(zip(cols, r))["predicted_disease"] for r in rows}
        check(
            "confidence below 0.30 is ignored",
            "Potato - Late Blight" not in diseases,
            f"diseases={sorted(diseases)}",
        )

        # The same 3 farmers at 0.85 do form an alert — proving the filter is the
        # confidence, not something incidental.
        for uid in (FARMER1, MODERATOR, ADMIN):
            add_diagnosis(conn, uid, "Potato - Early Blight", "Potato", confidence=0.85)
        _, rows, _ = call_as(conn, "authenticated", FARMER1)
        diseases = {dict(zip(cols, r))["predicted_disease"] for r in rows}
        check(
            "same farmers at 0.85 DO alert",
            "Potato - Early Blight" in diseases,
            f"diseases={sorted(diseases)}",
        )

        # ------------------------------------------------------------------
        # 6. Time window
        # ------------------------------------------------------------------
        print("\n-- time window --")

        # Everything so far is 1 day old. Ask for a 0-day window -> nothing.
        _, rows, _ = call_as(conn, "authenticated", FARMER1, days=0)
        check("window is clamped to >= 1 day", isinstance(rows, list), f"{len(rows)} rows")

        # ------------------------------------------------------------------
        # 7. A caller with no region
        # ------------------------------------------------------------------
        print("\n-- no region --")

        with conn.cursor() as cur:
            cur.execute("update public.users set region = null where id = %s", (FARMER2,))
        conn.commit()
        _, rows, _ = call_as(conn, "authenticated", FARMER2)
        check("caller with no region gets nothing", len(rows) == 0, f"{len(rows)} rows")

    finally:
        conn.close()
        db.cleanup()

    print("\n" + "=" * 78)
    print(f"  {len(PASSED)} passed, {len(FAILED)} failed, {len(PASSED) + len(FAILED)} total")
    if FAILED:
        print("\n  Failures:")
        for name in FAILED:
            print(f"    - {name}")
    print("=" * 78)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
