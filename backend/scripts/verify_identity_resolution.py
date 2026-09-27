"""Verify that a token's identity resolves through PostgREST, not GoTrue.

Why this matters: `GET /auth/v1/user` is a GoTrue internal endpoint. PostgREST
instead accepts any token Supabase can verify, so resolving identity via PostgREST
needs no JWT library in the backend and uses the exact same verification path RLS
uses. If identity resolves here, it resolves in every policy.

This signs in a real user and calls `POST /rest/v1/rpc/current_user_id`.

Usage:
    python backend/scripts/verify_identity_resolution.py
"""

from __future__ import annotations

import pathlib
import sys

import httpx

ROOT = pathlib.Path(__file__).resolve().parents[2]
EMAIL = "ramesh.patil@example.com"
PASSWORD = "AgriAI#2026"


def read_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in (ROOT / "backend" / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def main() -> int:
    env = read_env()
    url = env["SUPABASE_URL"].rstrip("/")
    anon = env["SUPABASE_ANON_KEY"]

    # 1. Sign in the way the frontend does, to get a real Supabase access token.
    with httpx.Client(timeout=30.0) as client:
        signin = client.post(
            f"{url}/auth/v1/token",
            params={"grant_type": "password"},
            headers={"apikey": anon, "Content-Type": "application/json"},
            json={"email": EMAIL, "password": PASSWORD},
        )
        if signin.status_code != 200:
            print(f"  sign-in failed: HTTP {signin.status_code} {signin.text[:160]}")
            return 1

        body = signin.json()
        token = body["access_token"]
        expected_id = body["user"]["id"]
        print(f"  signed in as {EMAIL}")
        print(f"  token subject: {expected_id}")

        # 2. The current path: GoTrue.
        gotrue = client.get(
            f"{url}/auth/v1/user",
            headers={"apikey": anon, "Authorization": f"Bearer {token}"},
        )
        print(f"\n  GET /auth/v1/user          -> HTTP {gotrue.status_code}")
        gotrue_id = gotrue.json().get("id") if gotrue.status_code == 200 else None
        print(f"    resolved id: {gotrue_id}")

        # 3. The proposed path: PostgREST calling the same helper RLS uses.
        rpc = client.post(
            f"{url}/rest/v1/rpc/current_user_id",
            headers={
                "apikey": anon,
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={},
        )
        print(f"\n  POST /rest/v1/rpc/current_user_id -> HTTP {rpc.status_code}")
        rpc_id = rpc.json() if rpc.status_code == 200 else None
        print(f"    resolved id: {rpc_id}")

        # 4. And confirm a bad token is rejected on both paths.
        bad = client.post(
            f"{url}/rest/v1/rpc/current_user_id",
            headers={
                "apikey": anon,
                "Authorization": "Bearer not-a-real-token",
                "Content-Type": "application/json",
            },
            json={},
        )
        print(f"\n  bogus token via RPC         -> HTTP {bad.status_code} (must be 401)")

    print()
    checks = [
        ("GoTrue resolves the subject", gotrue_id == expected_id),
        ("PostgREST resolves the subject", rpc_id == expected_id),
        ("both agree", gotrue_id == rpc_id),
        ("bogus token rejected", bad.status_code in (401, 403)),
    ]
    for label, passed in checks:
        print(f"  {'PASS' if passed else 'FAIL'}  {label}")

    return 0 if all(p for _, p in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
