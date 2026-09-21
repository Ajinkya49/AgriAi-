"""Create the four development test accounts on a HOSTED Supabase project.

Why this exists
---------------
`supabase/seed.sql` creates auth users with a direct `INSERT INTO auth.users`.
That works against local PostgreSQL (and is what the local test harness uses),
but it does **not** work against a hosted Supabase project: GoTrue v2 resolves
email/password sign-ins through `auth.identities`, and a hand-written
`auth.users` row has no matching identity. Sign-in then fails with the opaque
error:

    {"code":500,"error_code":"unexpected_failure","msg":"Database error querying schema"}

The supported route is the **Admin API**, which creates the `auth.users` row,
the `auth.identities` row, and the bcrypt password hash correctly in one call.

What it does (idempotent — safe to re-run)
------------------------------------------
1. Creates the four test users via `POST /auth/v1/admin/users`.
2. Fills in `role` / `region` / `primary_crops` on their `public.users` profile
   rows (created automatically by the `on_auth_user_created` trigger).
3. Ensures the "Tomato Farmers" community, its memberships, and one post exist.

Usage
-----
    ~/.workbuddy-ai/binaries/python/envs/agri-ai-dbcheck/Scripts/python.exe \
        supabase/scripts/seed_test_users.py

Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL from
`backend/.env`. Requires `psycopg2` (present in the dbcheck venv).
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

import psycopg2

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPO_ROOT / "backend" / ".env"

PASSWORD = "AgriAI#2026"

TEST_USERS = [
    {
        "email": "ramesh.patil@example.com",
        "name": "Ramesh Patil",
        "role": "farmer",
        "region": "Maharashtra",
        "primary_crops": ["Tomato", "Wheat"],
    },
    {
        "email": "sunita.devi@example.com",
        "name": "Sunita Devi",
        "role": "farmer",
        "region": "Bihar",
        "primary_crops": ["Tomato"],
    },
    {
        "email": "moderator@agriai.example",
        "name": "KVK Moderator",
        "role": "moderator",
        "region": "Maharashtra",
        "primary_crops": [],
    },
    {
        "email": "admin@agriai.example",
        "name": "Agri AI Admin",
        "role": "admin",
        "region": "Maharashtra",
        "primary_crops": [],
    },
]

COMMUNITY_NAME = "Tomato Farmers"
COMMUNITY_DESCRIPTION = (
    "For farmers growing tomato — share what is working on your field, ask about "
    "problems, and compare notes on pests and disease."
)
POST_CONTENT = (
    "Lower leaves of my tomato plants are getting brown spots with rings inside "
    "them. Has anyone else seen this in the last two weeks?"
)


def load_env() -> dict[str, str]:
    """Parse backend/.env into a dict."""
    if not ENV_FILE.exists():
        raise SystemExit(f"Missing {ENV_FILE}")
    env: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


def admin_request(
    base_url: str, service_key: str, method: str, path: str, payload: dict | None = None
) -> tuple[int, object]:
    """Call the Supabase Admin API and return (status_code, parsed_body)."""
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        f"{base_url}{path}",
        data=data,
        method=method,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode()
            return resp.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        try:
            return exc.code, json.loads(body)
        except json.JSONDecodeError:
            return exc.code, body


def list_users(base_url: str, service_key: str) -> dict[str, str]:
    """Return {email: user_id} for every user in the project."""
    status, body = admin_request(base_url, service_key, "GET", "/auth/v1/admin/users")
    if status != 200 or not isinstance(body, dict):
        raise SystemExit(f"Could not list users: {status} {body}")
    return {u["email"]: u["id"] for u in body.get("users", []) if u.get("email")}


def main() -> int:
    env = load_env()
    base_url = env.get("SUPABASE_URL", "").rstrip("/")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    db_url = env.get("DATABASE_URL", "")

    if not base_url or not service_key:
        raise SystemExit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from backend/.env")
    if not db_url:
        raise SystemExit("DATABASE_URL missing from backend/.env")

    print(f"Project: {base_url}")
    print(f"Test password for all accounts: {PASSWORD}\n")

    # ---- 1. Create the users via the Admin API ----------------------------
    existing = list_users(base_url, service_key)
    created_ids: dict[str, str] = {}

    for user in TEST_USERS:
        email = user["email"]
        if email in existing:
            created_ids[email] = existing[email]
            print(f"  exists   {email}")
            continue

        status, body = admin_request(
            base_url,
            service_key,
            "POST",
            "/auth/v1/admin/users",
            {
                "email": email,
                "password": PASSWORD,
                "email_confirm": True,
                "user_metadata": {"name": user["name"]},
            },
        )
        if status in (200, 201) and isinstance(body, dict):
            created_ids[email] = body["id"]
            print(f"  created  {email}  ({body['id']})")
        else:
            print(f"  FAILED   {email}: {status} {body}")
            return 1

    # ---- 2. Profile fields + community data ------------------------------
    conn = psycopg2.connect(db_url, connect_timeout=20)
    conn.autocommit = False
    cur = conn.cursor()

    for user in TEST_USERS:
        cur.execute(
            """
            update public.users
               set name = %s, role = %s, region = %s, primary_crops = %s
             where id = %s
            """,
            (
                user["name"],
                user["role"],
                user["region"],
                user["primary_crops"],
                created_ids[user["email"]],
            ),
        )
        if cur.rowcount != 1:
            conn.rollback()
            raise SystemExit(
                f"Profile row missing for {user['email']} — the "
                f"on_auth_user_created trigger did not fire."
            )
    print("\n  profiles updated (name, role, region, primary_crops)")

    owner_id = created_ids["ramesh.patil@example.com"]
    member_id = created_ids["sunita.devi@example.com"]

    cur.execute(
        """
        insert into public.communities (name, description, created_by)
        values (%s, %s, %s)
        on conflict do nothing
        returning id
        """,
        (COMMUNITY_NAME, COMMUNITY_DESCRIPTION, owner_id),
    )
    row = cur.fetchone()
    if row:
        community_id = row[0]
        print(f"  community created: {COMMUNITY_NAME}")
    else:
        cur.execute("select id from public.communities where name = %s", (COMMUNITY_NAME,))
        found = cur.fetchone()
        if not found:
            conn.rollback()
            raise SystemExit("Community exists but could not be located.")
        community_id = found[0]
        print(f"  community exists:  {COMMUNITY_NAME}")

    cur.execute(
        """
        insert into public.community_members (community_id, user_id)
        values (%s, %s), (%s, %s)
        on conflict (community_id, user_id) do nothing
        """,
        (community_id, owner_id, community_id, member_id),
    )

    cur.execute(
        "select count(*) from public.posts where community_id = %s", (community_id,)
    )
    if cur.fetchone()[0] == 0:
        cur.execute(
            """
            insert into public.posts (community_id, user_id, content)
            values (%s, %s, %s)
            """,
            (community_id, owner_id, POST_CONTENT),
        )
        print("  post created")

    conn.commit()

    cur.execute("select email, role, region from public.users order by role, email")
    print("\n  public.users:")
    for email, role, region in cur.fetchall():
        print(f"    {email:<28} {role:<10} {region}")

    cur.execute("select count(*) from auth.identities")
    print(f"\n  auth.identities rows: {cur.fetchone()[0]}  (must equal the user count)")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
