"""Pydantic models for the auth endpoints (Phase 3)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ProfileOut(BaseModel):
    """A row from `public.users`, i.e. the farmer profile."""

    # `extra="ignore"` keeps this resilient if the table gains columns later.
    model_config = ConfigDict(extra="ignore")

    id: str
    email: str | None = None
    phone: str | None = None
    name: str = ""
    region: str | None = None
    primary_crops: list[str] | None = None
    role: str = "farmer"


class MeOut(BaseModel):
    """The verified caller plus their profile row."""

    id: str
    email: str | None = None
    phone: str | None = None
    profile: ProfileOut | None = None
