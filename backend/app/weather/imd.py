"""IMD (India Meteorological Department) API client.

The weather feature is served by IMD's official gateway (`api.imd.gov.in`),
accessed with a key issued by the IMD API Management Portal, sent as the
`X-API-KEY` header (see the portal's user guide). The key lives in
`IMD_API_KEY` and is optional: without it the module reports `configured=False`
and the route returns a clean "not configured" response — weather is a
supplementary feature and the rest of the app never depends on it.

Only the **city forecast (7 days)** product is used. It gives daily max/min
temperature, a weather description, humidity and rainfall — everything the
advisory rules need — in one request per location. District warnings would add
precision but also a second dependency and a second failure mode; they can be
layered on later without changing the response shape.

Caching: IMD revises forecasts twice a day and the portal rate-limits keys, so
responses are cached in-process per station. A 30-minute TTL keeps farmers on
the same data while bounding staleness well under IMD's own issue cadence.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import get_settings
from app.core.logging import get_logger
from app.weather.locations import Station

logger = get_logger(__name__)


class ImdUnavailableError(RuntimeError):
    """The IMD gateway could not be reached or returned unusable data."""


@dataclass(frozen=True)
class DayForecast:
    """One forecast day, normalised out of IMD's `Day_N_*` fields."""

    label: str  # "Today", "Tomorrow", "In 3 days" is derived in the route layer
    max_temp_c: float | None
    min_temp_c: float | None
    weather: str  # IMD's free-text description, e.g. "Light rain"


@dataclass(frozen=True)
class CityForecast:
    """The normalised city forecast for one station."""

    station_code: str
    station_name: str
    observed_at: str  # IMD observation date, YYYY-mm-dd
    days: list[DayForecast]


# ---------------------------------------------------------------------------
# In-process cache — key: station code.
# ---------------------------------------------------------------------------

_CACHE: dict[str, tuple[float, CityForecast]] = {}
_CACHE_TTL_SECONDS = get_settings().weather_cache_ttl_minutes * 60


def _cache_get(station_code: str) -> CityForecast | None:
    entry = _CACHE.get(station_code)
    if entry is None:
        return None
    fetched_at, forecast = entry
    if time.monotonic() - fetched_at > _CACHE_TTL_SECONDS:
        _CACHE.pop(station_code, None)
        return None
    return forecast


def _cache_put(station_code: str, forecast: CityForecast) -> None:
    _CACHE[station_code] = (time.monotonic(), forecast)


def clear_cache() -> None:
    """Empty the in-process cache (used by tests)."""
    _CACHE.clear()


# ---------------------------------------------------------------------------
# Field extraction
# ---------------------------------------------------------------------------


def _to_float(value: Any) -> float | None:
    """IMD numbers arrive as strings, sometimes empty; never trust them."""
    if value is None:
        return None
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def _to_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _extract_days(payload: dict[str, Any]) -> list[DayForecast]:
    """Pull the seven `Day_N_*` triplets out of IMD's flat response.

    Day 1 is `Todays_Forecast`; days 2–7 are `Day_2_Forecast`… `Day_7_Forecast`.
    Days missing both a temperature and a description are dropped — a row of
    empty cells is not a forecast, and the advisory layer prefers fewer, real
    days over padded ones.
    """
    days: list[DayForecast] = []

    def _take(n: int, label: str) -> None:
        # Day 1 uses different field names from days 2-7 — IMD spells it
        # `Todays_Forecast[_Max_Temp/_Min_temp]` but `Day_2[_Max_Temp/_Min_temp]`.
        if n == 1:
            weather = _to_text(payload.get("Todays_Forecast"))
            max_t = _to_float(payload.get("Todays_Forecast_Max_Temp"))
            min_t = _to_float(payload.get("Todays_Forecast_Min_temp"))
        else:
            weather = _to_text(payload.get(f"Day_{n}"))
            max_t = _to_float(payload.get(f"Day_{n}_Max_Temp"))
            min_t = _to_float(payload.get(f"Day_{n}_Min_temp"))
        if weather or max_t is not None or min_t is not None:
            days.append(
                DayForecast(label=label, max_temp_c=max_t, min_temp_c=min_t, weather=weather)
            )

    _take(1, "Today")
    for n in range(2, 8):
        _take(n, f"Day {n}")
    return days


def fetch_city_forecast(station: Station) -> CityForecast:
    """Fetch (or serve from cache) the 7-day city forecast for `station`.

    Synchronous on purpose: the FastAPI route runs it in a threadpool, matching
    how every other blocking call in this codebase is handled.
    """
    cached = _cache_get(station.code)
    if cached is not None:
        return cached

    settings = get_settings()
    if not settings.is_weather_configured:
        raise ImdUnavailableError("IMD_API_KEY is not set on the backend.")

    url = f"{settings.imd_api_base_url}/cityforecast"
    try:
        response = httpx.get(
            url,
            params={"id": station.code},
            headers={"X-API-KEY": settings.imd_api_key},
            timeout=settings.weather_timeout_seconds,
        )
    except httpx.HTTPError as exc:
        logger.warning("IMD request failed for station %s: %s", station.code, exc)
        raise ImdUnavailableError("The weather service could not be reached.") from exc

    if response.status_code == 429:
        raise ImdUnavailableError("The weather service is rate-limited right now.")
    if response.status_code != 200:
        logger.warning(
            "IMD returned HTTP %s for station %s: %s",
            response.status_code,
            station.code,
            _to_text(response.text)[:200],
        )
        raise ImdUnavailableError("The weather service returned an error.")

    try:
        body = response.json()
    except ValueError as exc:
        raise ImdUnavailableError("The weather service returned unreadable data.") from exc

    # The gateway wraps results in {status, data|records|...}; accept the shapes
    # it has been observed to use, plus a bare object, so a gateway tweak does
    # not break parsing.
    records: list[dict[str, Any]] = []
    if isinstance(body, dict):
        for key in ("data", "records", "result", "forecast"):
            value = body.get(key)
            if isinstance(value, list):
                records = [r for r in value if isinstance(r, dict)]
                break
            if isinstance(value, dict):
                records = [value]
                break
        if not records and body.get("Station_Code"):
            records = [body]
    elif isinstance(body, list):
        records = [r for r in body if isinstance(r, dict)]

    if not records:
        raise ImdUnavailableError("The weather service returned no forecast rows.")

    payload = records[0]
    days = _extract_days(payload)
    if not days:
        raise ImdUnavailableError("The weather service returned an empty forecast.")

    forecast = CityForecast(
        station_code=station.code,
        station_name=_to_text(payload.get("Station_Name")) or station.name,
        observed_at=_to_text(payload.get("Date")),
        days=days,
    )
    _cache_put(station.code, forecast)
    return forecast
