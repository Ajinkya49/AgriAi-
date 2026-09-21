"""One-time bootstrap: record already-applied migrations in the ledger.

Migrations 1-5 were applied to the live project by hand before
`apply_migrations.py` existed, so the ledger starts empty and would otherwise try
to re-run them.

This checks the objects those migrations create actually exist before recording
them as applied — baselining a migration that was never run would hide a missing
schema.

Usage:
    python supabase/scripts/bootstrap_migration_ledger.py
"""

from __future__ import annotations

import pathlib
import sys

import psycopg2

ROOT = pathlib.Path(__file__).resolve().parents[2]

# A representative object from each of migrations 1-5. If these exist, the
# migration ran. Checking one distinctive thing per migration is enough to catch
# "never applied" without re-deriving the whole schema.
EXPECTED = {
    "20260915000001_initial_schema.sql": (
        "select count(*) from information_schema.tables "
        "where table_schema='public' and table_name in "
        "('users','diagnoses','solutions','posts','comments','communities',"
        "'community_members','post_likes','assistant_conversations','assistant_messages')",
        10,
    ),
    "20260915000002_indexes.sql": (
        "select count(*) from pg_indexes "
        "where schemaname='public' and indexname like '%_idx'",
        1,  # at least one
    ),
    "20260915000003_rls_policies.sql": (
        "select count(*) from pg_policies where schemaname='public'",
        20,  # at least the core set
    ),
    "20260915000004_solutions_knowledge_base.sql": (
        "select count(*) from public.solutions",
        40,  # at least most of the 50
    ),
    "20260917000001_public_profiles.sql": (
        "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
        "where n.nspname='public' and p.proname='public_profiles'",
        1,
    ),
}


def read_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in (ROOT / "backend" / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def main() -> int:
    conn = psycopg2.connect(read_env()["DATABASE_URL"])
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute(
        "create table if not exists public.schema_migrations ("
        "  filename text primary key,"
        "  applied_at timestamptz not null default now()"
        ")"
    )

    ok = True
    for filename, (query, minimum) in EXPECTED.items():
        cur.execute(query)
        found = cur.fetchone()[0]
        present = found >= minimum
        ok = ok and present
        mark = "OK  " if present else "MISS"
        print(f"  {mark} {filename:<44} {found} >= {minimum}")

    if not ok:
        print("\n  refusing to baseline — at least one migration looks unapplied")
        conn.rollback()
        conn.close()
        return 1

    for filename in EXPECTED:
        cur.execute(
            "insert into public.schema_migrations (filename) values (%s) "
            "on conflict (filename) do nothing",
            (filename,),
        )
    conn.commit()
    print(f"\n  baselined {len(EXPECTED)} migration(s)")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
