"""Apply pending migrations to the live Supabase project.

There was no way to do this before — migrations were only ever applied to the
embedded Postgres used by the test suite, so the live project's schema drifted
from the repo by hand.

Safety properties:

* A `schema_migrations` ledger makes this idempotent. Running it twice is a no-op.
* Each migration runs in its own transaction. A failure rolls that migration back
  completely rather than leaving a half-applied schema.
* `--dry-run` lists what would run without touching anything.

The first run against an existing project will see every migration as pending,
including ones already applied by hand. `--baseline` marks them as applied
without executing them — use it once, after checking the live schema really does
match.

Usage:
    python supabase/scripts/apply_migrations.py --dry-run
    python supabase/scripts/apply_migrations.py --baseline
    python supabase/scripts/apply_migrations.py
"""

from __future__ import annotations

import argparse
import pathlib
import sys

import psycopg2

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "supabase" / "migrations"

LEDGER = """
create table if not exists public.schema_migrations (
  filename    text primary key,
  applied_at  timestamptz not null default now()
);
"""


def read_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in (ROOT / "backend" / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def migration_files() -> list[pathlib.Path]:
    return sorted(MIGRATIONS.glob("*.sql"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="list, do not apply")
    parser.add_argument(
        "--baseline",
        action="store_true",
        help="record every migration as applied WITHOUT running it",
    )
    args = parser.parse_args()

    conn = psycopg2.connect(read_env()["DATABASE_URL"])
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute(LEDGER)
    conn.commit()

    cur.execute("select filename from public.schema_migrations")
    applied = {r[0] for r in cur.fetchall()}

    files = migration_files()
    pending = [f for f in files if f.name not in applied]

    print(f"  {len(files)} migration(s) on disk, {len(applied)} recorded applied")
    if not pending:
        print("  nothing to do")
        conn.close()
        return 0

    print(f"  {len(pending)} pending:")
    for f in pending:
        print(f"    {f.name}")

    if args.dry_run:
        print("\n  dry run — nothing applied")
        conn.close()
        return 0

    if args.baseline:
        for f in pending:
            cur.execute(
                "insert into public.schema_migrations (filename) values (%s) "
                "on conflict (filename) do nothing",
                (f.name,),
            )
            print(f"    baselined {f.name}")
        conn.commit()
        print(f"\n  {len(pending)} migration(s) recorded as applied WITHOUT executing")
        conn.close()
        return 0

    for f in pending:
        sql = f.read_text(encoding="utf-8")
        try:
            cur.execute(sql)
            cur.execute(
                "insert into public.schema_migrations (filename) values (%s)",
                (f.name,),
            )
            conn.commit()
            print(f"    applied {f.name}")
        except Exception as exc:  # noqa: BLE001
            conn.rollback()
            print(f"    FAILED  {f.name}")
            print(f"            {type(exc).__name__}: {str(exc).splitlines()[0]}")
            conn.close()
            return 1

    conn.close()
    print(f"\n  {len(pending)} migration(s) applied")
    return 0


if __name__ == "__main__":
    sys.exit(main())
