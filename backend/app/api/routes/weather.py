"""Weather advisory endpoints (IMD data).

`GET /api/weather` — the forecast + derived advisories for the caller's region.
`GET /api/weather/status` — whether the IMD key is configured.

The caller's region comes from their own `public.users` row, read through a
user-scoped client so RLS decides visibility, exactly like `/auth/me`. Weather
itself is public data, but the *request* is authenticated: a forecast is
useless without knowing whose region to resolve, and keeping the endpoint
behind the session means the frontend reuses its existing `apiFetch` path.

Failure shape: every downstream problem — key missing, IMD down, region not an
Indian state — degrades to a structured 200/503 with a `reason`, never a stack
trace, because a weather card must never break a screen the way a failed crop
check would.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from fastapi.concurrency import run_in_threadpool

from app.config import get_settings
from app.core.logging import get_logger
from app.core.security import BearerToken, CurrentUser, user_scoped_client
from app.schemas.weather import AdvisoryOut, WeatherDayOut, WeatherOut, WeatherStatusOut
from app.weather.advisory import build_advisories
from app.weather.imd import ImdUnavailableError, fetch_city_forecast
from app.weather.locations import station_for_region

logger = get_logger(__name__)

router = APIRouter(prefix="/weather", tags=["weather"])


def _load_region(user_id: str, token: str) -> str | None:
    """The caller's own region, via RLS."""

    def _fetch() -> str | None:
        client = user_scoped_client(token)
        result = client.table("users").select("region").eq("id", user_id).limit(1).execute()
        rows = result.data or []
        return rows[0].get("region") if rows else None

    return _fetch()


@router.get("", response_model=WeatherOut)
async def get_weather(user: CurrentUser, token: BearerToken) -> WeatherOut:
    """The IMD 7-day city forecast + advisories for the caller's region."""
    region = await run_in_threadpool(_load_region, user.id, token)
    if not region or not region.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No region is set on your profile. Add one in Settings to see "
                "your local weather."
            ),
        )

    station = station_for_region(region)
    if station is None:
        # A free-text region that is not an Indian state has no honest forecast.
        # 422 with a readable reason — the fix (Settings) is a farmer action.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f'We couldn\'t match "{region}" to a supported state. Please pick '
                "your state again in Settings."
            ),
        )

    try:
        forecast = await run_in_threadpool(fetch_city_forecast, station)
    except ImdUnavailableError as exc:
        logger.warning("Weather unavailable for %s: %s", region, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    bundle = build_advisories(forecast)
    rain_words = ("rain", "drizzle", "shower", "thunderstorm")
    days = [
        WeatherDayOut(
            label=d.label,
            max_temp_c=d.max_temp_c,
            min_temp_c=d.min_temp_c,
            weather=d.weather,
            rain_expected=any(w in d.weather.casefold() for w in rain_words),
        )
        for d in forecast.days
    ]

    return WeatherOut(
        region=region,
        station_name=forecast.station_name,
        observed_at=forecast.observed_at,
        fetched_at=datetime.now(UTC).isoformat(),
        days=days,
        advisories=[
            AdvisoryOut(
                title=a.title,
                title_hi=a.title_hi,
                detail=a.detail,
                detail_hi=a.detail_hi,
                day_labels=a.day_labels,
            )
            for a in bundle.advisories
        ],
        rain_expected=bundle.rain_expected,
    )


@router.get("/status", response_model=WeatherStatusOut)
async def weather_status() -> WeatherStatusOut:
    """Whether the IMD integration is configured (no external call)."""
    return WeatherStatusOut(configured=get_settings().is_weather_configured)
