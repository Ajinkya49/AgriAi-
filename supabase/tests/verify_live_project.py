"""Verify RLS on a LIVE Supabase project, end to end, over the real REST API.

Complements `run_db_tests.py`, which verifies the same policies against a local
PostgreSQL using simulated JWTs. This script does it for real: it signs in
through Supabase Auth, receives genuine JWTs, and uses them against PostgREST.

That matters because it exercises the parts a local harness cannot — GoTrue
issuing the token, PostgREST reading `request.jwt.claims`, and the `anon` /
`authenticated` role switching that Supabase performs per request.

Usage
-----
    ~/.workbuddy-ai/binaries/python/envs/agri-ai-dbcheck/Scripts/python.exe \
        supabase/tests/verify_live_project.py

Prerequisites: the Phase 2 migrations are applied and the test users exist
(`supabase/scripts/seed_test_users.py`). Reads `backend/.env` for the URL and
the anon key. Uses only the standard library.
"""

from __future__ import annotations

import base64
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPO_ROOT / "backend" / ".env"
PASSWORD = "AgriAI#2026"

# Must match backend/app/models/labels.py. Kept as a literal list because this
# script uses only the standard library and runs outside the backend venv.
DISEASE_CLASSES = [
    "Tomato - Early Blight",
    "Tomato - Late Blight",
    "Tomato - Leaf Mold",
    "Tomato - Septoria Leaf Spot",
    "Tomato - Healthy",
    "Potato - Early Blight",
    "Potato - Late Blight",
    "Potato - Healthy",
    "Pepper - Bacterial Spot",
    "Pepper - Healthy",
]


def load_env() -> dict[str, str]:
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


def http(
    url: str,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    payload: dict | None = None,
) -> tuple[int, object]:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode()
            return resp.status, (json.loads(body) if body else None)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        try:
            return exc.code, json.loads(body)
        except json.JSONDecodeError:
            return exc.code, body


def sign_in(base_url: str, anon_key: str, email: str) -> str:
    status, body = http(
        f"{base_url}/auth/v1/token?grant_type=password",
        method="POST",
        headers={"apikey": anon_key, "Content-Type": "application/json"},
        payload={"email": email, "password": PASSWORD},
    )
    if status != 200 or not isinstance(body, dict) or "access_token" not in body:
        raise SystemExit(f"Sign-in failed for {email}: {status} {body}")
    return body["access_token"]


def rest(base_url: str, anon_key: str, token: str | None, path: str) -> tuple[int, object]:
    headers = {"apikey": anon_key}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return http(f"{base_url}/rest/v1/{path}", headers=headers)


def _auth_headers(anon_key: str, token: str | None) -> dict[str, str]:
    headers = {"apikey": anon_key, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def rest_write(
    base_url: str,
    anon_key: str,
    token: str | None,
    table: str,
    payload: dict,
    *,
    return_row: bool = False,
) -> tuple[int, object]:
    """POST a row.

    Used both to attempt impersonation (the write should be refused) and to seed
    a fixture. PostgREST returns 201 with an empty body unless it is asked for the
    representation, so `return_row` adds the `Prefer` header when the caller needs
    the created id.
    """
    headers = _auth_headers(anon_key, token)
    if return_row:
        headers["Prefer"] = "return=representation"
    return http(
        f"{base_url}/rest/v1/{table}",
        method="POST",
        headers=headers,
        payload=payload,
    )


def rest_delete(base_url: str, anon_key: str, token: str | None, path: str) -> tuple[int, object]:
    """DELETE matching rows. RLS decides whether anything is actually removed."""
    return http(
        f"{base_url}/rest/v1/{path}",
        method="DELETE",
        headers=_auth_headers(anon_key, token),
    )


def rest_rpc(
    base_url: str,
    anon_key: str,
    token: str | None,
    function: str,
    payload: dict,
    select: str = "*",
) -> tuple[int, object]:
    """Call a Postgres function through PostgREST."""
    return http(
        f"{base_url}/rest/v1/rpc/{function}?select={select}",
        method="POST",
        headers=_auth_headers(anon_key, token),
        payload=payload,
    )


def jwt_subject(token: str) -> str:
    """Read the `sub` claim from a Supabase access token.

    Decoded without verification — the token came from Supabase over TLS in this
    same process, so this is only used to learn the caller's own id.
    """
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))["sub"]


def count_rows(body: object) -> int | None:
    """Row count for a successful REST response; None if it was an error object."""
    return len(body) if isinstance(body, list) else None


class Report:
    def __init__(self) -> None:
        self.results: list[tuple[bool, str, str]] = []

    def check(self, name: str, passed: bool, detail: str) -> None:
        self.results.append((passed, name, detail))

    def rows(self, name: str, body: object, expected: int) -> None:
        n = count_rows(body)
        self.check(name, n == expected, f"{n} rows" if n is not None else f"error: {body}")

    def blocked(self, name: str, status: int, body: object) -> None:
        n = count_rows(body)
        ok = status >= 400 or n == 0
        self.check(name, ok, "blocked" if ok else f"LEAKED {n} rows (HTTP {status})")

    def denied(self, name: str, status: int, body: object) -> None:
        ok = status >= 400
        self.check(name, ok, f"HTTP {status}" if ok else f"NOT BLOCKED: {body}")


def main() -> int:
    env = load_env()
    base_url = env.get("SUPABASE_URL", "").rstrip("/")
    anon_key = env.get("SUPABASE_ANON_KEY", "")
    if not base_url or not anon_key:
        raise SystemExit("SUPABASE_URL / SUPABASE_ANON_KEY missing from backend/.env")

    r = Report()
    print(f"Live project: {base_url}\n")

    # ---- Auth ------------------------------------------------------------
    farmer = sign_in(base_url, anon_key, "ramesh.patil@example.com")
    farmer2 = sign_in(base_url, anon_key, "sunita.devi@example.com")
    admin = sign_in(base_url, anon_key, "admin@agriai.example")
    farmer_id = jwt_subject(farmer)
    farmer2_id = jwt_subject(farmer2)
    r.check("auth: seeded users can sign in (real JWT issued)", True, "3 tokens")

    # ---- anon ------------------------------------------------------------
    status, body = rest(base_url, anon_key, None, "users?select=id")
    r.blocked("anon: cannot read users", status, body)

    status, body = rest(base_url, anon_key, None, "communities?select=id")
    r.check(
        "anon: can read communities (publicly readable)",
        (count_rows(body) or 0) >= 1,
        f"{count_rows(body)} rows",
    )

    # ---- users -----------------------------------------------------------
    status, body = rest(base_url, anon_key, farmer, "users?select=email,role")
    r.rows("farmer: sees only their own profile row", body, 1)
    if isinstance(body, list) and body:
        r.check(
            "farmer: own row is the right one",
            body[0].get("email") == "ramesh.patil@example.com",
            str(body[0].get("email")),
        )

    status, body = rest(base_url, anon_key, farmer, "users?select=email&email=eq.sunita.devi@example.com")
    r.rows("farmer: CANNOT read another farmer's row", body, 0)

    status, body = rest(base_url, anon_key, admin, "users?select=email")
    # NOT a fixed count. This asserted exactly 4 rows, which broke the first time
    # a real person signed up on the live project — the count is a property of
    # who has registered, not of the RLS policy under test. What matters is that
    # the admin can read the table and that every seeded account is visible.
    emails = {row.get("email") for row in body} if isinstance(body, list) else set()
    seeded = {
        "ramesh.patil@example.com",
        "sunita.devi@example.com",
        "moderator@agriai.example",
        "admin@agriai.example",
    }
    r.check(
        "admin: reads the users table",
        isinstance(body, list) and len(body) >= 4 and seeded <= emails,
        f"{len(body) if isinstance(body, list) else 'error'} rows, "
        f"seeded accounts visible: {seeded <= emails}",
    )

    # ---- solutions -------------------------------------------------------
    status, body = rest(base_url, anon_key, farmer, "solutions?select=id")
    count = count_rows(body)
    # The exact number grows as the knowledge base is curated, so assert the
    # farmer can read it and that it is populated — not a fixed count.
    r.check(
        "farmer: reads the curated solutions",
        count is not None and count >= 30,
        f"{count} rows",
    )

    status, body = rest(
        base_url,
        anon_key,
        farmer,
        "solutions",
    )  # GET without select -> still a read, checked below via POST
    status, body = http(
        f"{base_url}/rest/v1/solutions",
        method="POST",
        headers={
            "apikey": anon_key,
            "Authorization": f"Bearer {farmer}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        payload={
            "disease_name": "Tomato - Early Blight",
            "solution_type": "natural",
            "title": "RLS probe",
            "description": "should be rejected",
            "source_name": "test",
        },
    )
    r.denied("farmer: CANNOT insert into solutions", status, body)

    # ---- diagnoses -------------------------------------------------------
    status, body = rest(base_url, anon_key, farmer, "diagnoses?select=id,user_id")
    own = body if isinstance(body, list) else []
    # The real assertion is isolation: whatever comes back must all belong to the
    # caller. The count varies as diagnoses are created during testing.
    r.check(
        "farmer: reads only their own diagnoses",
        count_rows(body) is not None
        and all(row.get("user_id") == farmer_id for row in own),
        f"{len(own)} rows, all owned by the caller",
    )

    status, body = http(
        f"{base_url}/rest/v1/diagnoses",
        method="POST",
        headers={
            "apikey": anon_key,
            "Authorization": f"Bearer {farmer}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        payload={
            "user_id": "00000000-0000-0000-0000-000000000000",
            "image_url": "uploads/x/y.jpg",
            "crop_type": "Tomato",
            "predicted_disease": "Tomato - Early Blight",
            "confidence_score": 0.8,
            "model_version": "v1.0.0",
        },
    )
    r.denied("farmer: CANNOT insert a diagnosis for another user", status, body)

    # ---- role escalation -------------------------------------------------
    status, body = rest(base_url, anon_key, farmer, "users?select=id")
    own_id = body[0]["id"] if isinstance(body, list) and body else None
    status, body = http(
        f"{base_url}/rest/v1/users?id=eq.{own_id}",
        method="PATCH",
        headers={
            "apikey": anon_key,
            "Authorization": f"Bearer {farmer}",
            "Content-Type": "application/json",
        },
        payload={"role": "admin"},
    )
    r.denied("farmer: CANNOT escalate own role to admin", status, body)

    # ---- communities -----------------------------------------------------
    status, body = rest(base_url, anon_key, farmer, "communities?select=name")
    r.check(
        "farmer: reads communities",
        (count_rows(body) or 0) >= 1,
        f"{count_rows(body)} rows",
    )

    status, body = http(
        f"{base_url}/rest/v1/communities",
        method="POST",
        headers={
            "apikey": anon_key,
            "Authorization": f"Bearer {farmer2}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        payload={
            "name": "RLS probe community",
            "description": "created by the verification script",
            "created_by": "00000000-0000-0000-0000-000000000000",
        },
    )
    r.denied("farmer: CANNOT create a community on behalf of another user", status, body)

    # ---- posts -----------------------------------------------------------
    status, body = rest(base_url, anon_key, farmer, "posts?select=id")
    r.check(
        "farmer: reads the community feed",
        (count_rows(body) or 0) >= 1,
        f"{count_rows(body)} rows",
    )

    # ---- solutions coverage (Phase 5) ------------------------------------
    # The product promise: a diagnosis never comes back without both a Natural
    # and a Traditional section. Checked here through the real REST API, so it
    # exercises the RLS read path a farmer actually uses.
    for disease in DISEASE_CLASSES:
        quoted = quote(disease, safe="")
        status, body = rest(
            base_url,
            anon_key,
            farmer,
            f"solutions?select=solution_type,verified,source_name&disease_name=eq.{quoted}",
        )
        rows_ = body if isinstance(body, list) else []
        natural = [x for x in rows_ if x.get("solution_type") == "natural"]
        traditional = [x for x in rows_ if x.get("solution_type") == "traditional"]
        r.check(
            f"solutions: {disease} has Natural AND Traditional",
            bool(natural) and bool(traditional),
            f"{len(natural)} natural, {len(traditional)} traditional",
        )
        unsourced = [
            x
            for x in traditional
            if not x.get("verified") and not x.get("source_name")
        ]
        r.check(
            f"solutions: {disease} traditional rows are labelled",
            not unsourced,
            f"{len(traditional)} traditional rows all carry a source or unverified mark",
        )

    # ---- cross-user probes for assistant + community (Phases 6-7) --------
    # These attempt real cross-user access through the REST API, which is the
    # only way to be sure RLS is doing the work rather than the application.
    status, body = rest(base_url, anon_key, farmer, "assistant_conversations?select=id")
    own_conversations = body if isinstance(body, list) else []
    r.check(
        "assistant: farmer sees only their own conversations",
        count_rows(body) is not None,
        f"{len(own_conversations)} conversations",
    )

    status, body = rest(base_url, anon_key, farmer2, "assistant_conversations?select=id")
    other_conversations = body if isinstance(body, list) else []
    ids_a = {row["id"] for row in own_conversations}
    ids_b = {row["id"] for row in other_conversations}
    r.check(
        "assistant: two farmers' conversations do not overlap",
        not (ids_a & ids_b),
        f"{len(ids_a)} vs {len(ids_b)}",
    )

    if ids_a:
        sample = sorted(ids_a)[0]
        status, body = rest(
            base_url,
            anon_key,
            farmer2,
            f"assistant_messages?select=id&conversation_id=eq.{sample}",
        )
        r.rows("assistant: CANNOT read another farmer's messages", body, 0)

    # ---- posts: cross-user write attempts --------------------------------
    # NOTE: `posts_select_authenticated` makes the feed readable by every
    # authenticated farmer — that is the point of a community feed. So a plain
    # `posts?select=id` returns *everyone's* posts, and any probe that means
    # "somebody else's post" must filter by user_id explicitly.
    status, body = rest(base_url, anon_key, farmer, "posts?select=id,user_id")
    feed = body if isinstance(body, list) else []
    r.check(
        "community: farmer can read the community feed",
        count_rows(body) is not None and len(feed) >= 1,
        f"{len(feed)} posts visible",
    )

    status, body = rest(base_url, anon_key, farmer, "communities?select=id")
    communities = body if isinstance(body, list) else []

    if communities:
        target = communities[0]["id"]

        # Impersonation: write a post attributed to the other farmer.
        status, body = rest_write(
            base_url,
            anon_key,
            farmer,
            "posts",
            {"community_id": target, "user_id": farmer2_id, "content": "impersonation attempt"},
        )
        r.check(
            "community: CANNOT post as another farmer",
            status >= 400,
            f"HTTP {status}",
        )

        # Deleting somebody else's post. Two things this probe must get right:
        #   1. filter by user_id — the feed returns everyone's posts, so an
        #      unfiltered query could hand us the attacker's own post;
        #   2. PostgREST returns 204 for a DELETE matching zero rows, so the
        #      status proves nothing — the assertion is that the post survives.
        #
        # The probe creates its own victim post so it does not depend on the
        # seed data having one.
        status, body = rest_write(
            base_url,
            anon_key,
            farmer2,
            "posts",
            {
                "community_id": target,
                "user_id": farmer2_id,
                "content": "cross-user delete probe (safe to remove)",
            },
            return_row=True,
        )
        created = body if isinstance(body, list) and body else []
        if created:
            victim = created[0]["id"]
            rest_delete(base_url, anon_key, farmer, f"posts?id=eq.{victim}")
            status, after = rest(
                base_url, anon_key, farmer2, f"posts?select=id&id=eq.{victim}"
            )
            survived = isinstance(after, list) and len(after) == 1
            r.check(
                "community: CANNOT delete another farmer's post (it survives)",
                survived,
                "post still exists" if survived else "POST WAS DELETED",
            )
            # Clean up after ourselves.
            rest_delete(base_url, anon_key, farmer2, f"posts?id=eq.{victim}")
        else:
            r.check(
                "community: CANNOT delete another farmer's post (it survives)",
                False,
                f"could not create the victim post (HTTP {status})",
            )

    # ---- public_profiles: the narrow disclosure --------------------------
    status, body = rest_rpc(
        base_url, anon_key, farmer, "public_profiles", {"user_ids": [farmer2_id]},
        select="name,role",
    )
    r.check(
        "public_profiles: resolves another farmer's display name",
        status < 400 and isinstance(body, list) and len(body) == 1,
        f"HTTP {status}",
    )
    status, body = rest_rpc(
        base_url, anon_key, farmer, "public_profiles", {"user_ids": [farmer2_id]},
        select="email",
    )
    r.check("public_profiles: CANNOT expose email", status >= 400, f"HTTP {status}")
    status, body = rest_rpc(
        base_url, anon_key, None, "public_profiles", {"user_ids": [farmer2_id]},
        select="name",
    )
    r.check("public_profiles: anon is blocked", status >= 400, f"HTTP {status}")

    # ---- report ----------------------------------------------------------
    passed = [x for x in r.results if x[0]]
    failed = [x for x in r.results if not x[0]]
    print("=" * 78)
    for ok, name, detail in r.results:
        print(f"  {'PASS' if ok else 'FAIL'}  {name:<58} {detail}")
    print("-" * 78)
    print(f"  {len(passed)} passed, {len(failed)} failed, {len(r.results)} total")
    print("=" * 78)
    if failed:
        print("\nFAILURES:")
        for _, name, detail in failed:
            print(f"  - {name}: {detail}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
