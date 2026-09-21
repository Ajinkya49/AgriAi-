"""Phase 2 verification harness.

Spins up a throwaway PostgreSQL instance, applies the Supabase migrations and
seed data, then executes the Row Level Security policies as real database roles
(`anon`, `authenticated`, `service_role`) with a simulated JWT subject.

This is how the Phase 2 "Done when" criterion is checked:

    "all tables exist with RLS enforced, and seeded data is queryable only
     according to the intended access rules"

Run it with the dbcheck virtualenv (it needs `pgserver` + `psycopg2`, which are
test-only dependencies and deliberately not in the backend requirements):

    ~/.workbuddy-ai/binaries/python/envs/agri-ai-dbcheck/Scripts/python.exe \
        supabase/tests/run_db_tests.py

Every RLS test runs inside its own transaction which is always rolled back, so
the tests never interfere with each other and the database is left as seeded.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import psycopg2
import psycopg2.errors

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"
SEED_FILE = REPO_ROOT / "supabase" / "seed.sql"
SHIM_FILE = REPO_ROOT / "supabase" / "tests" / "00_local_auth_shim.sql"
PGDATA = Path.home() / ".workbuddy-ai" / "binaries" / "python" / "pgdata" / "agri-ai"

# --- Fixed identifiers from seed.sql ---------------------------------------
FARMER1 = "11111111-1111-4111-8111-111111111111"
FARMER2 = "22222222-2222-4222-8222-222222222222"
MODERATOR = "33333333-3333-4333-8333-333333333333"
ADMIN = "44444444-4444-4444-8444-444444444444"
COMMUNITY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
POST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

# --- Fixtures created by the harness itself ---------------------------------
DIAG1 = "d1111111-1111-4111-8111-111111111111"  # belongs to FARMER1
DIAG2 = "d2222222-2222-4222-8222-222222222222"  # belongs to FARMER2
CONV1 = "c1111111-1111-4111-8111-111111111111"  # belongs to FARMER1
MSG1 = "e1111111-1111-4111-8111-111111111111"
COMMENT1 = "f1111111-1111-4111-8111-111111111111"  # by FARMER1 on POST
LIKE1 = "a1111111-1111-4111-8111-111111111111"  # by FARMER2 on POST

EXPECTED_TABLES = [
    "assistant_conversations",
    "assistant_messages",
    "comments",
    "communities",
    "community_members",
    "diagnoses",
    "post_likes",
    "posts",
    "solutions",
    "users",
]

# Indexes named in 05-BackendSchema-AgriAI.md (the post_likes one is backed by
# the post_likes_unique_per_user constraint rather than a standalone index).
EXPECTED_INDEXES = [
    "diagnoses_user_id_created_at_idx",
    "solutions_disease_name_solution_type_idx",
    "posts_community_id_created_at_idx",
    "comments_post_id_created_at_idx",
    "community_members_user_id_idx",
    "post_likes_unique_per_user",
]


class Result:
    """Outcome of a single assertion."""

    def __init__(self, name: str, passed: bool, detail: str) -> None:
        self.name = name
        self.passed = passed
        self.detail = detail


def apply_sql_file(conn, path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()


def build_database(conn) -> None:
    """Reset, then apply shim -> migrations (in order) -> seed.

    The reset makes the harness repeatable against a reused PGDATA directory:
    every run starts from an empty database rather than layering on the last run.
    """
    with conn.cursor() as cur:
        cur.execute("drop schema if exists public cascade")
        cur.execute("create schema public")
        cur.execute("drop schema if exists auth cascade")
    conn.commit()

    apply_sql_file(conn, SHIM_FILE)

    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not migration_files:
        raise SystemExit(f"No migrations found in {MIGRATIONS_DIR}")
    for path in migration_files:
        apply_sql_file(conn, path)

    apply_sql_file(conn, SEED_FILE)

    # --- Extra fixtures the RLS suite needs (not part of the Phase 2 seed spec).
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into public.diagnoses
              (id, user_id, image_url, crop_type, predicted_disease,
               confidence_score, symptoms_summary, model_version)
            values
              (%s, %s, %s, 'Tomato', 'Tomato - Early Blight',
               0.82, 'Brown concentric spots on lower leaves.', 'v1.0.0'),
              (%s, %s, %s, 'Wheat', 'Wheat - Leaf Rust',
               0.41, 'Orange-brown pustules on leaf surface.', 'v1.0.0')
            on conflict (id) do nothing
            """,
            (
                DIAG1,
                FARMER1,
                f"uploads/{FARMER1}/{DIAG1}.jpg",
                DIAG2,
                FARMER2,
                f"uploads/{FARMER2}/{DIAG2}.jpg",
            ),
        )
        cur.execute(
            """
            insert into public.assistant_conversations (id, user_id, diagnosis_id)
            values (%s, %s, %s)
            on conflict (id) do nothing
            """,
            (CONV1, FARMER1, DIAG1),
        )
        cur.execute(
            """
            insert into public.assistant_messages (id, conversation_id, role, content)
            values (%s, %s, 'assistant', 'Water at the base of the plant only.')
            on conflict (id) do nothing
            """,
            (MSG1, CONV1),
        )
        cur.execute(
            """
            insert into public.comments (id, post_id, user_id, content)
            values (%s, %s, %s, 'Same here in my field last season.')
            on conflict (id) do nothing
            """,
            (COMMENT1, POST, FARMER1),
        )
        cur.execute(
            """
            insert into public.post_likes (id, post_id, user_id)
            values (%s, %s, %s)
            on conflict (id) do nothing
            """,
            (LIKE1, POST, FARMER2),
        )
    conn.commit()


def run_as(conn, role: str | None, user_id: str | None, sql: str, params: tuple = ()):
    """Execute `sql` as `role` with a simulated JWT subject, then roll back.

    Returns (status, payload) where status is 'ok' or 'error':
      * 'ok'    -> payload is (rows, rowcount)
      * 'error' -> payload is the exception
    """
    cur = conn.cursor()
    try:
        cur.execute("begin")
        if role:
            cur.execute(f"set local role {role}")
        claims = {"role": role or "postgres"}
        if user_id:
            claims["sub"] = user_id
        cur.execute(
            "select set_config('request.jwt.claims', %s, true)",
            (json.dumps(claims),),
        )
        cur.execute(sql, params)
        rows = cur.fetchall() if cur.description else None
        return "ok", (rows, cur.rowcount)
    except Exception as exc:  # noqa: BLE001 - any DB error is a test outcome
        return "error", exc
    finally:
        cur.execute("rollback")
        cur.close()


def rows_of(result) -> int | None:
    status, payload = result
    if status != "ok":
        return None
    return len(payload[0]) if payload[0] is not None else None


def rowcount_of(result) -> int | None:
    status, payload = result
    if status != "ok":
        return None
    return payload[1]


# ===========================================================================
# Assertions
# ===========================================================================


def schema_tests(conn) -> list[Result]:
    out: list[Result] = []
    cur = conn.cursor()

    cur.execute(
        """
        select tablename from pg_tables
        where schemaname = 'public' and tablename = any(%s)
        order by tablename
        """,
        (EXPECTED_TABLES,),
    )
    found = [r[0] for r in cur.fetchall()]
    missing = sorted(set(EXPECTED_TABLES) - set(found))
    out.append(
        Result(
            "all 10 Backend Schema tables exist",
            not missing,
            f"found {len(found)}/10" + (f", missing {missing}" if missing else ""),
        )
    )

    cur.execute(
        """
        select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and c.relname = any(%s)
          and c.relrowsecurity
        """,
        (EXPECTED_TABLES,),
    )
    rls_on = sorted(r[0] for r in cur.fetchall())
    no_rls = sorted(set(EXPECTED_TABLES) - set(rls_on))
    out.append(
        Result(
            "RLS enabled on all 10 tables",
            not no_rls,
            f"{len(rls_on)}/10 enabled" + (f", MISSING RLS: {no_rls}" if no_rls else ""),
        )
    )

    cur.execute(
        "select indexname from pg_indexes where schemaname = 'public' and indexname = any(%s)",
        (EXPECTED_INDEXES,),
    )
    idx = sorted(r[0] for r in cur.fetchall())
    missing_idx = sorted(set(EXPECTED_INDEXES) - set(idx))
    out.append(
        Result(
            "all 6 Backend Schema indexes exist",
            not missing_idx,
            f"found {len(idx)}/6" + (f", missing {missing_idx}" if missing_idx else ""),
        )
    )

    cur.execute("select count(*) from public.solutions")
    solution_count = cur.fetchone()[0]
    # The knowledge base grows as content is curated, so assert it is populated
    # rather than pinning an exact number that will need editing every time.
    out.append(
        Result(
            "knowledge base: solutions present",
            solution_count >= 30,
            f"{solution_count} rows",
        )
    )

    cur.close()
    return out


def rls_tests(conn) -> list[Result]:
    """Each entry: (name, role, user, sql, params, expectation).

    expectation is a (kind, value) pair:
      ("rows", n)      exactly n rows returned
      ("min_rows", n)  at least n rows returned
      ("rowcount", n)  exactly n rows affected by INSERT/UPDATE/DELETE
      ("error", None)  the statement must raise
      ("blocked", None) must either raise or return 0 rows
    """
    T: list[tuple] = [
        # ---------------- users ----------------
        ("users: farmer reads own row", "authenticated", FARMER1,
         "select id from public.users where id = %s", (FARMER1,), ("rows", 1)),
        ("users: farmer CANNOT read another user's row", "authenticated", FARMER1,
         "select id from public.users where id = %s", (FARMER2,), ("rows", 0)),
        ("users: farmer sees only 1 row in total", "authenticated", FARMER1,
         "select id from public.users", (), ("rows", 1)),
        ("users: moderator sees only their own row", "authenticated", MODERATOR,
         "select id from public.users", (), ("rows", 1)),
        ("users: admin reads all rows", "authenticated", ADMIN,
         "select id from public.users", (), ("rows", 4)),
        ("users: anon is blocked", "anon", None,
         "select id from public.users", (), ("blocked", None)),
        ("users: farmer updates own profile", "authenticated", FARMER1,
         "update public.users set region = 'Gujarat' where id = %s", (FARMER1,),
         ("rowcount", 1)),
        ("users: farmer CANNOT update another user", "authenticated", FARMER1,
         "update public.users set region = 'Hacked' where id = %s", (FARMER2,),
         ("rowcount", 0)),
        ("users: farmer CANNOT escalate own role to admin", "authenticated", FARMER1,
         "update public.users set role = 'admin' where id = %s", (FARMER1,),
         ("error", None)),
        ("users: admin CAN change a role", "authenticated", ADMIN,
         "update public.users set role = 'moderator' where id = %s", (FARMER2,),
         ("rowcount", 1)),
        ("users: farmer CANNOT delete another user", "authenticated", FARMER1,
         "delete from public.users where id = %s", (FARMER2,), ("rowcount", 0)),

        # ---------------- diagnoses ----------------
        ("diagnoses: farmer reads own", "authenticated", FARMER1,
         "select id from public.diagnoses", (), ("rows", 1)),
        ("diagnoses: farmer CANNOT read another's diagnosis", "authenticated", FARMER1,
         "select id from public.diagnoses where id = %s", (DIAG2,), ("rows", 0)),
        ("diagnoses: farmer inserts own", "authenticated", FARMER1,
         "insert into public.diagnoses (user_id, image_url, crop_type, "
         "predicted_disease, confidence_score, model_version) "
         "values (%s, 'uploads/x/y.jpg', 'Tomato', 'Tomato - Late Blight', 0.55, 'v1.0.0')",
         (FARMER1,), ("rowcount", 1)),
        ("diagnoses: farmer CANNOT insert for another user", "authenticated", FARMER1,
         "insert into public.diagnoses (user_id, image_url, crop_type, "
         "predicted_disease, confidence_score, model_version) "
         "values (%s, 'uploads/x/y.jpg', 'Tomato', 'Tomato - Late Blight', 0.55, 'v1.0.0')",
         (FARMER2,), ("error", None)),
        ("diagnoses: farmer CANNOT delete another's diagnosis", "authenticated", FARMER1,
         "delete from public.diagnoses where id = %s", (DIAG2,), ("rowcount", 0)),
        ("diagnoses: service_role bypasses RLS and sees all", "service_role", None,
         "select id from public.diagnoses", (), ("rows", 2)),

        # ---------------- solutions ----------------
        ("solutions: authenticated farmer reads the curated entries",
         "authenticated", FARMER1, "select id from public.solutions", (), ("min_rows", 30)),
        ("solutions: farmer CANNOT insert", "authenticated", FARMER1,
         "insert into public.solutions (disease_name, solution_type, title, "
         "description, source_name) values ('X', 'natural', 't', 'd', 's')",
         (), ("error", None)),
        ("solutions: farmer CANNOT update", "authenticated", FARMER1,
         "update public.solutions set verified = true", (), ("rowcount", 0)),
        ("solutions: farmer CANNOT delete", "authenticated", FARMER1,
         "delete from public.solutions", (), ("rowcount", 0)),
        ("solutions: moderator CANNOT write (admin-only resolution)",
         "authenticated", MODERATOR,
         "insert into public.solutions (disease_name, solution_type, title, "
         "description, source_name) values ('X', 'natural', 't', 'd', 's')",
         (), ("error", None)),
        ("solutions: admin CAN insert", "authenticated", ADMIN,
         "insert into public.solutions (disease_name, solution_type, title, "
         "description, source_name, verified) "
         "values ('Tomato - Early Blight', 'natural', 'Test', 'Test', 'ICAR', true)",
         (), ("rowcount", 1)),
        ("solutions: anon is blocked", "anon", None,
         "select id from public.solutions", (), ("blocked", None)),

        # ---------------- assistant ----------------
        ("assistant: farmer reads own conversation", "authenticated", FARMER1,
         "select id from public.assistant_conversations", (), ("rows", 1)),
        ("assistant: other farmer sees none", "authenticated", FARMER2,
         "select id from public.assistant_conversations", (), ("rows", 0)),
        ("assistant: farmer reads messages of own conversation", "authenticated", FARMER1,
         "select id from public.assistant_messages where conversation_id = %s",
         (CONV1,), ("rows", 1)),
        ("assistant: farmer CANNOT read another's messages", "authenticated", FARMER2,
         "select id from public.assistant_messages where conversation_id = %s",
         (CONV1,), ("rows", 0)),
        ("assistant: farmer creates own conversation", "authenticated", FARMER1,
         "insert into public.assistant_conversations (user_id) values (%s)",
         (FARMER1,), ("rowcount", 1)),
        ("assistant: farmer CANNOT create for another user", "authenticated", FARMER1,
         "insert into public.assistant_conversations (user_id) values (%s)",
         (FARMER2,), ("error", None)),

        # ---------------- communities ----------------
        ("communities: anon can read (publicly readable)", "anon", None,
         "select id from public.communities", (), ("rows", 1)),
        ("communities: authenticated can read", "authenticated", FARMER1,
         "select id from public.communities", (), ("rows", 1)),
        ("communities: any authenticated user can create", "authenticated", FARMER2,
         "insert into public.communities (name, description, created_by) "
         "values ('Wheat Growers', 'd', %s)", (FARMER2,), ("rowcount", 1)),
        ("communities: CANNOT create on behalf of another user", "authenticated", FARMER2,
         "insert into public.communities (name, description, created_by) "
         "values ('Fake', 'd', %s)", (FARMER1,), ("error", None)),
        ("communities: non-owner CANNOT edit", "authenticated", FARMER2,
         "update public.communities set name = 'Hijacked' where id = %s",
         (COMMUNITY,), ("rowcount", 0)),
        ("communities: owner CAN edit", "authenticated", FARMER1,
         "update public.communities set description = 'Updated' where id = %s",
         (COMMUNITY,), ("rowcount", 1)),
        ("communities: admin CAN edit any", "authenticated", ADMIN,
         "update public.communities set description = 'Moderated' where id = %s",
         (COMMUNITY,), ("rowcount", 1)),

        # ---------------- community_members ----------------
        ("community_members: anon can read", "anon", None,
         "select id from public.community_members", (), ("min_rows", 2)),
        ("community_members: farmer CANNOT add another user", "authenticated", FARMER1,
         "insert into public.community_members (community_id, user_id) values (%s, %s)",
         (COMMUNITY, ADMIN), ("error", None)),
        ("community_members: farmer CANNOT remove another user", "authenticated", FARMER1,
         "delete from public.community_members where user_id = %s", (FARMER2,),
         ("rowcount", 0)),
        ("community_members: farmer CAN leave own community", "authenticated", FARMER1,
         "delete from public.community_members where community_id = %s and user_id = %s",
         (COMMUNITY, FARMER1), ("rowcount", 1)),
        ("community_members: duplicate join is rejected", "authenticated", FARMER2,
         "insert into public.community_members (community_id, user_id) values (%s, %s)",
         (COMMUNITY, FARMER2), ("error", None)),

        # ---------------- posts ----------------
        ("posts: authenticated farmer can read the feed", "authenticated", FARMER2,
         "select id from public.posts", (), ("rows", 1)),
        ("posts: anon is blocked", "anon", None,
         "select id from public.posts", (), ("blocked", None)),
        ("posts: farmer creates own post", "authenticated", FARMER2,
         "insert into public.posts (community_id, user_id, content) "
         "values (%s, %s, 'My tomato leaves look better this week.')",
         (COMMUNITY, FARMER2), ("rowcount", 1)),
        ("posts: CANNOT post as another user", "authenticated", FARMER2,
         "insert into public.posts (community_id, user_id, content) "
         "values (%s, %s, 'Impersonation attempt')", (COMMUNITY, FARMER1),
         ("error", None)),
        ("posts: non-author CANNOT edit", "authenticated", FARMER2,
         "update public.posts set content = 'Hijacked' where id = %s", (POST,),
         ("rowcount", 0)),
        ("posts: author CAN edit own post", "authenticated", FARMER1,
         "update public.posts set content = 'Edited by author' where id = %s", (POST,),
         ("rowcount", 1)),
        ("posts: moderator CAN edit any post", "authenticated", MODERATOR,
         "update public.posts set content = 'Moderated' where id = %s", (POST,),
         ("rowcount", 1)),
        ("posts: non-author CANNOT delete", "authenticated", FARMER2,
         "delete from public.posts where id = %s", (POST,), ("rowcount", 0)),
        ("posts: author CAN delete own post", "authenticated", FARMER1,
         "delete from public.posts where id = %s", (POST,), ("rowcount", 1)),
        ("posts: admin CAN delete any post", "authenticated", ADMIN,
         "delete from public.posts where id = %s", (POST,), ("rowcount", 1)),

        # ---------------- comments ----------------
        ("comments: authenticated farmer can read", "authenticated", FARMER2,
         "select id from public.comments", (), ("rows", 1)),
        ("comments: farmer CANNOT comment as another user", "authenticated", FARMER2,
         "insert into public.comments (post_id, user_id, content) "
         "values (%s, %s, 'Impersonation attempt')", (POST, FARMER1), ("error", None)),
        ("comments: non-author CANNOT edit", "authenticated", FARMER2,
         "update public.comments set content = 'Hijacked' where id = %s", (COMMENT1,),
         ("rowcount", 0)),
        ("comments: moderator CAN edit any comment", "authenticated", MODERATOR,
         "update public.comments set content = 'Moderated' where id = %s", (COMMENT1,),
         ("rowcount", 1)),
        ("comments: non-author CANNOT delete", "authenticated", FARMER2,
         "delete from public.comments where id = %s", (COMMENT1,), ("rowcount", 0)),

        # ---------------- post_likes ----------------
        ("post_likes: farmer creates own like", "authenticated", FARMER1,
         "insert into public.post_likes (post_id, user_id) values (%s, %s)",
         (POST, FARMER1), ("rowcount", 1)),
        ("post_likes: CANNOT like as another user", "authenticated", FARMER1,
         "insert into public.post_likes (post_id, user_id) values (%s, %s)",
         (POST, ADMIN), ("error", None)),
        ("post_likes: duplicate like is rejected (unique)", "authenticated", FARMER2,
         "insert into public.post_likes (post_id, user_id) values (%s, %s)",
         (POST, FARMER2), ("error", None)),
        ("post_likes: CANNOT remove another user's like", "authenticated", FARMER1,
         "delete from public.post_likes where post_id = %s and user_id = %s",
         (POST, FARMER2), ("rowcount", 0)),
        ("post_likes: farmer CAN remove own like", "authenticated", FARMER2,
         "delete from public.post_likes where post_id = %s and user_id = %s",
         (POST, FARMER2), ("rowcount", 1)),

        # -- public_profiles(): the narrow disclosure that lets a feed show
        #    author names without opening the users table (Phase 7). ----------
        ("public_profiles: authenticated farmer resolves a display name",
         "authenticated", FARMER2,
         "select name from public.public_profiles(array[%s::text])", (FARMER1,),
         ("rows", 1)),
        ("public_profiles: returns the role too", "authenticated", FARMER2,
         "select role from public.public_profiles(array[%s::text])", (FARMER1,),
         ("rows", 1)),
        ("public_profiles: anon is blocked", "anon", None,
         "select name from public.public_profiles(array[%s::text])", (FARMER1,),
         ("blocked", None)),
        # The whole point of the function is that it is narrow. If either of these
        # ever starts passing, the disclosure has been widened by accident.
        ("public_profiles: does NOT expose email", "authenticated", FARMER2,
         "select email from public.public_profiles(array[%s::text])", (FARMER1,),
         ("error", None)),
        ("public_profiles: does NOT expose phone", "authenticated", FARMER2,
         "select phone from public.public_profiles(array[%s::text])", (FARMER1,),
         ("error", None)),
        ("public_profiles: does NOT expose region", "authenticated", FARMER2,
         "select region from public.public_profiles(array[%s::text])", (FARMER1,),
         ("error", None)),
        ("public_profiles: does NOT expose primary_crops", "authenticated", FARMER2,
         "select primary_crops from public.public_profiles(array[%s::text])", (FARMER1,),
         ("error", None)),
        ("public_profiles: unknown ids return no rows", "authenticated", FARMER2,
         "select name from public.public_profiles(array[gen_random_uuid()::text])", (),
         ("rows", 0)),
    ]

    results: list[Result] = []
    for name, role, user, sql, params, (kind, value) in T:
        result = run_as(conn, role, user, sql, params)

        if kind == "error":
            ok = result[0] == "error"
            detail = "raised as expected" if ok else f"expected an error, got {result[1][1]} row(s)"
        elif kind == "blocked":
            ok = result[0] == "error" or rows_of(result) == 0
            detail = "blocked" if ok else f"LEAKED {rows_of(result)} row(s)"
        elif kind == "rows":
            ok = rows_of(result) == value
            detail = (
                f"{rows_of(result)} rows"
                if ok
                else f"expected {value}, got {rows_of(result) if result[0] == 'ok' else result[1]}"
            )
        elif kind == "min_rows":
            n = rows_of(result)
            ok = n is not None and n >= value
            detail = f"{n} rows" if ok else f"expected >= {value}, got {n}"
        elif kind == "rowcount":
            ok = rowcount_of(result) == value
            detail = (
                f"{rowcount_of(result)} rows affected"
                if ok
                else f"expected {value} affected, got "
                f"{rowcount_of(result) if result[0] == 'ok' else result[1]}"
            )
        else:  # pragma: no cover
            ok, detail = False, f"unknown expectation {kind}"

        results.append(Result(name, ok, detail))

    return results


def main() -> int:
    import pgserver

    PGDATA.mkdir(parents=True, exist_ok=True)
    db = pgserver.get_server(str(PGDATA))
    try:
        conn = psycopg2.connect(db.get_uri())
        conn.autocommit = False

        build_database(conn)

        print("=" * 78)
        print("Agri AI — Phase 2 database verification")
        print("=" * 78)

        all_results: list[Result] = []
        all_results += schema_tests(conn)
        all_results += rls_tests(conn)

        passed = [r for r in all_results if r.passed]
        failed = [r for r in all_results if not r.passed]

        for r in all_results:
            print(f"  {'PASS' if r.passed else 'FAIL'}  {r.name:<62} {r.detail}")

        print("-" * 78)
        print(f"  {len(passed)} passed, {len(failed)} failed, {len(all_results)} total")
        print("=" * 78)

        if failed:
            print("\nFAILURES:")
            for r in failed:
                print(f"  - {r.name}: {r.detail}")
            return 1

        conn.close()
        return 0
    finally:
        db.cleanup()


if __name__ == "__main__":
    sys.exit(main())
