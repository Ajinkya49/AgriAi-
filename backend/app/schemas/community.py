"""Pydantic models for the community endpoints (Phase 7)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class AuthorOut(BaseModel):
    """Public display fields for a post or comment author.

    Resolved through `public.public_profiles()` — never from `public.users`
    directly, which is self-or-admin only. Deliberately excludes email, phone,
    region and crops.
    """

    id: str
    name: str
    role: str


class CommunityOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    description: str | None = None
    created_by: str
    created_at: str
    member_count: int = 0
    post_count: int = 0
    is_member: bool = False


class CommunityListOut(BaseModel):
    items: list[CommunityOut]
    total: int


class CommunityCreate(BaseModel):
    name: str = Field(min_length=3, max_length=80)
    description: str | None = Field(default=None, max_length=400)


class MembershipOut(BaseModel):
    community_id: str
    is_member: bool
    member_count: int


class PostOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    community_id: str
    community_name: str | None = None
    user_id: str
    author: AuthorOut | None = None
    content: str
    image_url: str | None = None
    image_signed_url: str | None = None
    diagnosis_id: str | None = None
    # A short "Tomato — Late Blight (99%)" line, so a shared diagnosis reads as
    # evidence rather than a bare id.
    diagnosis_summary: str | None = None
    created_at: str
    like_count: int = 0
    comment_count: int = 0
    liked_by_me: bool = False
    is_mine: bool = False


class PostDetailOut(PostOut):
    comments: list[CommentOut] = Field(default_factory=list)


class PostCreate(BaseModel):
    community_id: str
    content: str = Field(min_length=1, max_length=2000)
    # Optional: attach a diagnosis or an image, per the App Flow's `/post/new`.
    diagnosis_id: str | None = None
    image_url: str | None = None


class PostListOut(BaseModel):
    items: list[PostOut]
    total: int


class CommentOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    post_id: str
    user_id: str
    author: AuthorOut | None = None
    content: str
    created_at: str
    is_mine: bool = False


class CommentCreate(BaseModel):
    content: str = Field(min_length=1, max_length=1000)


class LikeOut(BaseModel):
    post_id: str
    liked: bool
    like_count: int


PostDetailOut.model_rebuild()
