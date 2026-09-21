"""Farmer community endpoints (Phase 7).

Communities, posts, comments and likes. Every read and write goes through the
caller's own JWT (`user_scoped_client`), so RLS decides what is visible and who
may write — the API does not re-implement those rules.

Author names come from `public.public_profiles()`, a deliberately narrow
SECURITY DEFINER function, because `public.users` is self-or-admin only.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status
from fastapi.concurrency import run_in_threadpool

from app.core.logging import get_logger
from app.core.security import BearerToken, CurrentUser, user_scoped_client
from app.schemas.community import (
    AuthorOut,
    CommentCreate,
    CommentOut,
    CommunityCreate,
    CommunityListOut,
    CommunityOut,
    LikeOut,
    MembershipOut,
    PostCreate,
    PostDetailOut,
    PostListOut,
    PostOut,
)

logger = get_logger(__name__)

router = APIRouter(tags=["community"])

FEED_PAGE_SIZE = 30


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _resolve_authors(client, user_ids: list[str]) -> dict[str, AuthorOut]:
    """Look up public display profiles for a batch of user ids.

    Returns only id / name / role. Falls back to an empty map on failure so a
    missing name degrades the feed rather than breaking it.
    """
    unique = sorted({uid for uid in user_ids if uid})
    if not unique:
        return {}

    try:
        result = client.rpc("public_profiles", {"user_ids": unique}).execute()
    except Exception:  # noqa: BLE001 - a missing name must not break the feed
        logger.warning("Could not resolve public profiles", exc_info=True)
        return {}

    authors: dict[str, AuthorOut] = {}
    for row in result.data or []:
        authors[str(row["id"])] = AuthorOut(
            id=str(row["id"]),
            name=row.get("name") or "A farmer",
            role=row.get("role") or "farmer",
        )
    return authors


def _counts_for(client, table: str, post_ids: list[str]) -> dict[str, int]:
    """Count rows in `table` grouped by post_id, for the given posts."""
    if not post_ids:
        return {}
    try:
        result = client.table(table).select("post_id").in_("post_id", post_ids).execute()
    except Exception:  # noqa: BLE001
        logger.warning("Could not count %s for the feed", table, exc_info=True)
        return {}

    counts: dict[str, int] = {}
    for row in result.data or []:
        key = str(row["post_id"])
        counts[key] = counts.get(key, 0) + 1
    return counts


def _enrich_posts(client, rows: list[dict], me_id: str) -> list[PostOut]:
    """Attach author, counts and the caller's own like state to raw post rows."""
    if not rows:
        return []

    post_ids = [str(r["id"]) for r in rows]
    authors = _resolve_authors(client, [str(r["user_id"]) for r in rows])
    likes = _counts_for(client, "post_likes", post_ids)
    comments = _counts_for(client, "comments", post_ids)

    # Which of these posts has the caller already liked?
    liked: set[str] = set()
    try:
        mine = (
            client.table("post_likes")
            .select("post_id")
            .eq("user_id", me_id)
            .in_("post_id", post_ids)
            .execute()
        )
        liked = {str(r["post_id"]) for r in (mine.data or [])}
    except Exception:  # noqa: BLE001
        logger.warning("Could not read own likes", exc_info=True)

    community_names = _community_names(client, [str(r["community_id"]) for r in rows])

    return [
        PostOut(
            id=str(row["id"]),
            community_id=str(row["community_id"]),
            community_name=community_names.get(str(row["community_id"])),
            user_id=str(row["user_id"]),
            author=authors.get(str(row["user_id"])),
            content=row["content"],
            image_url=row.get("image_url"),
            image_signed_url=None,
            diagnosis_id=row.get("diagnosis_id"),
            diagnosis_summary=None,
            created_at=str(row["created_at"]),
            like_count=likes.get(str(row["id"]), 0),
            comment_count=comments.get(str(row["id"]), 0),
            liked_by_me=str(row["id"]) in liked,
            is_mine=str(row["user_id"]) == me_id,
        )
        for row in rows
    ]


def _community_names(client, community_ids: list[str]) -> dict[str, str]:
    unique = sorted({cid for cid in community_ids if cid})
    if not unique:
        return {}
    try:
        result = client.table("communities").select("id,name").in_("id", unique).execute()
    except Exception:  # noqa: BLE001
        return {}
    return {str(r["id"]): r["name"] for r in (result.data or [])}


def _diagnosis_summaries(client, diagnosis_ids: list[str], me_id: str) -> dict[str, str]:
    """A short "Tomato — Late Blight (99%)" label for shared diagnoses.

    RLS means the caller can only read their own diagnoses, so a shared diagnosis
    only shows a summary to the farmer who owns it. Other viewers see the post
    text without the badge, which is the honest outcome — the diagnosis itself is
    private.
    """
    unique = sorted({d for d in diagnosis_ids if d})
    if not unique:
        return {}

    try:
        result = (
            client.table("diagnoses")
            .select("id,crop_type,predicted_disease,confidence_score")
            .eq("user_id", me_id)
            .in_("id", unique)
            .execute()
        )
    except Exception:  # noqa: BLE001
        return {}

    summaries: dict[str, str] = {}
    for row in result.data or []:
        display = row["predicted_disease"].replace(f"{row['crop_type']} - ", "")
        percent = min(99, int(float(row["confidence_score"]) * 100))
        summaries[str(row["id"])] = f"{row['crop_type']} — {display} ({percent}%)"
    return summaries


def _attach_diagnosis_summaries(client, posts: list[PostOut], me_id: str) -> list[PostOut]:
    """Fill in diagnosis_summary for posts that reference a diagnosis."""
    ids = [p.diagnosis_id for p in posts if p.diagnosis_id]
    if not ids:
        return posts
    summaries = _diagnosis_summaries(client, [str(i) for i in ids], me_id)
    for post in posts:
        if post.diagnosis_id:
            post.diagnosis_summary = summaries.get(str(post.diagnosis_id))
    return posts


# ---------------------------------------------------------------------------
# Communities
# ---------------------------------------------------------------------------


@router.get("/communities", response_model=CommunityListOut)
async def list_communities(user: CurrentUser, token: BearerToken) -> CommunityListOut:
    """Discover communities, with the caller's membership marked."""

    def _fetch() -> tuple[list[dict], set[str], dict[str, int], dict[str, int]]:
        client = user_scoped_client(token)
        communities = (
            client.table("communities").select("*").order("created_at").limit(100).execute()
        )
        rows = communities.data or []
        ids = [str(r["id"]) for r in rows]

        memberships = (
            client.table("community_members")
            .select("community_id")
            .eq("user_id", user.id)
            .execute()
        )
        joined = {str(r["community_id"]) for r in (memberships.data or [])}

        member_counts: dict[str, int] = {}
        if ids:
            result = (
                client.table("community_members")
                .select("community_id")
                .in_("community_id", ids)
                .execute()
            )
            for row in result.data or []:
                key = str(row["community_id"])
                member_counts[key] = member_counts.get(key, 0) + 1

        post_counts: dict[str, int] = {}
        if ids:
            result = client.table("posts").select("community_id").in_("community_id", ids).execute()
            for row in result.data or []:
                key = str(row["community_id"])
                post_counts[key] = post_counts.get(key, 0) + 1

        return rows, joined, member_counts, post_counts

    rows, joined, member_counts, post_counts = await run_in_threadpool(_fetch)

    items = [
        CommunityOut(
            id=str(r["id"]),
            name=r["name"],
            description=r.get("description"),
            created_by=str(r["created_by"]),
            created_at=str(r["created_at"]),
            member_count=member_counts.get(str(r["id"]), 0),
            post_count=post_counts.get(str(r["id"]), 0),
            is_member=str(r["id"]) in joined,
        )
        for r in rows
    ]
    return CommunityListOut(items=items, total=len(items))


@router.post("/communities", response_model=CommunityOut, status_code=status.HTTP_201_CREATED)
async def create_community(
    payload: CommunityCreate, user: CurrentUser, token: BearerToken
) -> CommunityOut:
    """Create a community. The creator is added as its first member."""

    def _create() -> dict:
        client = user_scoped_client(token)
        community_id = str(uuid.uuid4())
        created = (
            client.table("communities")
            .insert(
                {
                    "id": community_id,
                    "name": payload.name.strip(),
                    "description": (payload.description or "").strip() or None,
                    "created_by": user.id,
                }
            )
            .execute()
        )
        if not created.data:
            raise RuntimeError("Could not create the community")

        # Joining on creation is the obvious intent, and saves the farmer a tap.
        client.table("community_members").insert(
            {"id": str(uuid.uuid4()), "community_id": community_id, "user_id": user.id}
        ).execute()
        return created.data[0]

    try:
        row = await run_in_threadpool(_create)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Could not create community")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="We couldn't create that community. Please try again.",
        ) from exc

    return CommunityOut(
        id=str(row["id"]),
        name=row["name"],
        description=row.get("description"),
        created_by=str(row["created_by"]),
        created_at=str(row["created_at"]),
        member_count=1,
        post_count=0,
        is_member=True,
    )


@router.get("/communities/{community_id}", response_model=CommunityOut)
async def get_community(community_id: str, user: CurrentUser, token: BearerToken) -> CommunityOut:
    """One community, with the caller's membership marked."""

    def _fetch() -> tuple[dict | None, bool, int, int]:
        client = user_scoped_client(token)
        result = client.table("communities").select("*").eq("id", community_id).limit(1).execute()
        rows = result.data or []
        if not rows:
            return None, False, 0, 0

        membership = (
            client.table("community_members")
            .select("id")
            .eq("community_id", community_id)
            .eq("user_id", user.id)
            .limit(1)
            .execute()
        )
        members = (
            client.table("community_members")
            .select("id")
            .eq("community_id", community_id)
            .execute()
        )
        posts = client.table("posts").select("id").eq("community_id", community_id).execute()
        return (
            rows[0],
            bool(membership.data),
            len(members.data or []),
            len(posts.data or []),
        )

    row, is_member, member_count, post_count = await run_in_threadpool(_fetch)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="We couldn't find that community.",
        )

    return CommunityOut(
        id=str(row["id"]),
        name=row["name"],
        description=row.get("description"),
        created_by=str(row["created_by"]),
        created_at=str(row["created_at"]),
        member_count=member_count,
        post_count=post_count,
        is_member=is_member,
    )


@router.post("/communities/{community_id}/join", response_model=MembershipOut)
async def join_community(community_id: str, user: CurrentUser, token: BearerToken) -> MembershipOut:
    """Join a community. Idempotent — joining twice is not an error."""

    def _join() -> int:
        client = user_scoped_client(token)
        existing = (
            client.table("community_members")
            .select("id")
            .eq("community_id", community_id)
            .eq("user_id", user.id)
            .limit(1)
            .execute()
        )
        if not existing.data:
            client.table("community_members").insert(
                {"id": str(uuid.uuid4()), "community_id": community_id, "user_id": user.id}
            ).execute()

        members = (
            client.table("community_members")
            .select("id")
            .eq("community_id", community_id)
            .execute()
        )
        return len(members.data or [])

    try:
        count = await run_in_threadpool(_join)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Could not join community %s", community_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="We couldn't join that community. Please try again.",
        ) from exc

    return MembershipOut(community_id=community_id, is_member=True, member_count=count)


@router.delete("/communities/{community_id}/join", response_model=MembershipOut)
async def leave_community(
    community_id: str, user: CurrentUser, token: BearerToken
) -> MembershipOut:
    """Leave a community. RLS only permits deleting your own membership."""

    def _leave() -> int:
        client = user_scoped_client(token)
        client.table("community_members").delete().eq("community_id", community_id).eq(
            "user_id", user.id
        ).execute()
        members = (
            client.table("community_members")
            .select("id")
            .eq("community_id", community_id)
            .execute()
        )
        return len(members.data or [])

    count = await run_in_threadpool(_leave)
    return MembershipOut(community_id=community_id, is_member=False, member_count=count)


@router.get("/communities/{community_id}/posts", response_model=PostListOut)
async def list_community_posts(
    community_id: str, user: CurrentUser, token: BearerToken
) -> PostListOut:
    """The community feed — newest first."""

    def _fetch() -> list[PostOut]:
        client = user_scoped_client(token)
        result = (
            client.table("posts")
            .select("*")
            .eq("community_id", community_id)
            .order("created_at", desc=True)
            .limit(FEED_PAGE_SIZE)
            .execute()
        )
        posts = _enrich_posts(client, result.data or [], user.id)
        return _attach_diagnosis_summaries(client, posts, user.id)

    items = await run_in_threadpool(_fetch)
    return PostListOut(items=items, total=len(items))


# ---------------------------------------------------------------------------
# Posts
# ---------------------------------------------------------------------------


@router.post("/posts", response_model=PostOut, status_code=status.HTTP_201_CREATED)
async def create_post(payload: PostCreate, user: CurrentUser, token: BearerToken) -> PostOut:
    """Create a post, optionally attaching a diagnosis."""

    def _create() -> PostOut:
        client = user_scoped_client(token)
        created = (
            client.table("posts")
            .insert(
                {
                    "id": str(uuid.uuid4()),
                    "community_id": payload.community_id,
                    "user_id": user.id,
                    "content": payload.content.strip(),
                    "diagnosis_id": payload.diagnosis_id,
                    "image_url": payload.image_url,
                }
            )
            .execute()
        )
        if not created.data:
            raise RuntimeError("Could not create the post")
        posts = _enrich_posts(client, created.data, user.id)
        return _attach_diagnosis_summaries(client, posts, user.id)[0]

    try:
        return await run_in_threadpool(_create)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Could not create post")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="We couldn't publish your post. Please try again.",
        ) from exc


@router.get("/posts/{post_id}", response_model=PostDetailOut)
async def get_post(post_id: str, user: CurrentUser, token: BearerToken) -> PostDetailOut:
    """One post with its comments, oldest comment first (a conversation order)."""

    def _fetch() -> PostDetailOut | None:
        client = user_scoped_client(token)
        result = client.table("posts").select("*").eq("id", post_id).limit(1).execute()
        rows = result.data or []
        if not rows:
            return None

        posts = _attach_diagnosis_summaries(client, _enrich_posts(client, rows, user.id), user.id)
        post = posts[0]

        comments_result = (
            client.table("comments")
            .select("*")
            .eq("post_id", post_id)
            .order("created_at")
            .execute()
        )
        comment_rows = comments_result.data or []
        authors = _resolve_authors(client, [str(c["user_id"]) for c in comment_rows])

        comments = [
            CommentOut(
                id=str(c["id"]),
                post_id=str(c["post_id"]),
                user_id=str(c["user_id"]),
                author=authors.get(str(c["user_id"])),
                content=c["content"],
                created_at=str(c["created_at"]),
                is_mine=str(c["user_id"]) == user.id,
            )
            for c in comment_rows
        ]

        return PostDetailOut(**post.model_dump(), comments=comments)

    detail = await run_in_threadpool(_fetch)
    if detail is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="We couldn't find that post.",
        )
    return detail


@router.post(
    "/posts/{post_id}/comments",
    response_model=CommentOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_comment(
    post_id: str, payload: CommentCreate, user: CurrentUser, token: BearerToken
) -> CommentOut:
    """Reply to a post."""

    def _create() -> CommentOut:
        client = user_scoped_client(token)
        created = (
            client.table("comments")
            .insert(
                {
                    "id": str(uuid.uuid4()),
                    "post_id": post_id,
                    "user_id": user.id,
                    "content": payload.content.strip(),
                }
            )
            .execute()
        )
        if not created.data:
            raise RuntimeError("Could not create the comment")

        row = created.data[0]
        authors = _resolve_authors(client, [user.id])
        return CommentOut(
            id=str(row["id"]),
            post_id=str(row["post_id"]),
            user_id=str(row["user_id"]),
            author=authors.get(user.id),
            content=row["content"],
            created_at=str(row["created_at"]),
            is_mine=True,
        )

    try:
        return await run_in_threadpool(_create)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Could not create comment")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="We couldn't post your reply. Please try again.",
        ) from exc


@router.post("/posts/{post_id}/like", response_model=LikeOut)
async def like_post(post_id: str, user: CurrentUser, token: BearerToken) -> LikeOut:
    """Like a post. Idempotent."""

    def _like() -> int:
        client = user_scoped_client(token)
        existing = (
            client.table("post_likes")
            .select("id")
            .eq("post_id", post_id)
            .eq("user_id", user.id)
            .limit(1)
            .execute()
        )
        if not existing.data:
            client.table("post_likes").insert(
                {"id": str(uuid.uuid4()), "post_id": post_id, "user_id": user.id}
            ).execute()
        likes = client.table("post_likes").select("id").eq("post_id", post_id).execute()
        return len(likes.data or [])

    count = await run_in_threadpool(_like)
    return LikeOut(post_id=post_id, liked=True, like_count=count)


@router.delete("/posts/{post_id}/like", response_model=LikeOut)
async def unlike_post(post_id: str, user: CurrentUser, token: BearerToken) -> LikeOut:
    """Remove your own like. RLS only permits deleting your own row."""

    def _unlike() -> int:
        client = user_scoped_client(token)
        client.table("post_likes").delete().eq("post_id", post_id).eq("user_id", user.id).execute()
        likes = client.table("post_likes").select("id").eq("post_id", post_id).execute()
        return len(likes.data or [])

    count = await run_in_threadpool(_unlike)
    return LikeOut(post_id=post_id, liked=False, like_count=count)
