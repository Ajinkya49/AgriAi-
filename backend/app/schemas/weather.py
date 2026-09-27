"""Pydantic models for the weather endpoints."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class WeatherDayOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    label: str
    max_temp_c: float | None
    min_temp_c: float | None
    weather: str
    rain_expected: bool


class AdvisoryOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str
    title_hi: str
    detail: str
    detail_hi: str
    day_labels: list[str]


class WeatherOut(BaseModel):
    """Everything the /weather screen renders, in one response."""

    model_config = ConfigDict(extra="ignore")

    region: str
    station_name: str
    observed_at: str
    fetched_at: str  # when the backend served this (ISO 8601)
    days: list[WeatherDayOut]
    advisories: list[AdvisoryOut]
    rain_expected: bool


class WeatherStatusOut(BaseModel):
    """Reported by /api/health/dependencies alongside the other dependencies."""

    configured: bool
