"""Snapshot every row in the live project before a schema migration.

A code backup does not protect the database. This does — cheaply, at this size —
so a type migration can be reasoned about rather than hoped about.

Usage:
    python supabase/scripts/snapshot_live_data.py [output.json]
"""

from __future__ import annotations

import json
import pathlib
import sys
from datetime import date, datetime

import psycopg2

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_OUT = ROOT.parent / "_backup-agri-ai-20260920-145231" / "live-data-snapshot.json"


def read_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in (ROOT / "backend" / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def main() -> int:
    out_path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT

    conn = psycopg2.connect(read_env()["DATABASE_URL"])
    cur = conn.cursor()

    cur.execute(
        """
        select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name
        """
    )
    tables = [r[0] for r in cur.fetchall()]

    dump: dict[str, list[dict]] = {}
    for table in tables:
        cur.execute(f'select * from public."{table}"')
        columns = [d[0] for d in cur.description]
        rows = []
        for row in cur.fetchall():
            record = {}
            for column, value in zip(columns, row):
                if isinstance(value, (datetime, date)):
                    record[column] = value.isoformat()
                elif value is None or isinstance(value, (str, int, float, bool, list, dict)):
                    record[column] = value
                else:
                    record[column] = str(value)
            rows.append(record)
        dump[table] = rows

    conn.close()

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(dump, indent=2, default=str), encoding="utf-8")

    total = sum(len(v) for v in dump.values())
    print(f"  snapshot -> {out_path}")
    print(f"  {len(dump)} tables, {total} rows")
    for table, rows in sorted(dump.items(), key=lambda kv: -len(kv[1])):
        if rows:
            print(f"    {table:<28} {len(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
