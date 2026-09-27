"""Weather feature tests — advisory rules, IMD parsing, and the API surface.

All external calls are stubbed at the `httpx` boundary, so no test touches the
real IMD gateway (which needs a paid/registered key and is rate-limited).
"""

from __future__ import annotations

from typing import Any

import pytest

from app.config import get_settings
from app.weather.advisory import build_advisories
from app.weather.imd import (
    CityForecast,
    DayForecast,
    ImdUnavailableError,
    _extract_days,
    clear_cache,
    fetch_city_forecast,
)
from app.weather.locations import station_for_region

# ---------------------------------------------------------------------------
# locations
# ---------------------------------------------------------------------------


def test_region_resolves_case_insensitively() -> None:
    assert station_for_region("maharashtra") is not None
    assert station_for_region("  Maharashtra  ") is not None


def test_unknown_region_returns_none() -> None:
    assert station_for_region("Vidarbha") is None
    assert station_for_region("") is None
    assert station_for_region(None) is None


# ---------------------------------------------------------------------------
# advisory rules — each rule's trigger AND non-trigger case
# ---------------------------------------------------------------------------


def _forecast(days: list[DayForecast]) -> CityForecast:
    return CityForecast(
        station_code="43003", station_name="Mumbai", observed_at="2026-09-23", days=days
    )


def test_rain_advisory_triggers_and_names_days() -> None:
    bundle = build_advisories(
        _forecast(
            [
                DayForecast("Today", 30.0, 24.0, "Generally cloudy"),
                DayForecast("Tomorrow", 29.0, 24.0, "Light rain"),
            ]
        )
    )
    assert bundle.rain_expected is True
    assert len(bundle.advisories) == 1
    a = bundle.advisories[0]
    assert "rain" in a.title.casefold()
    assert a.day_labels == ["Tomorrow"]


def test_thunderstorm_counts_as_rain() -> None:
    bundle = build_advisories(
        _forecast([DayForecast("Today", 31.0, 25.0, "Thunderstorm with rain")])
    )
    assert bundle.rain_expected is True


def test_dry_forecast_produces_no_advisories() -> None:
    bundle = build_advisories(
        _forecast(
            [
                DayForecast("Today", 32.0, 22.0, "Mainly clear"),
                DayForecast("Tomorrow", 33.0, 23.0, "Partly cloudy sky"),
            ]
        )
    )
    assert bundle.rain_expected is False
    assert bundle.advisories == []


def test_heat_advisory_triggers_only_above_threshold() -> None:
    # 36.9 stays silent, 37.0 triggers.
    below = build_advisories(_forecast([DayForecast("Today", 36.9, 25.0, "Clear sky")]))
    assert below.advisories == []
    at = build_advisories(_forecast([DayForecast("Today", 37.0, 25.0, "Clear sky")]))
    assert any("heat" in a.title.casefold() for a in at.advisories)


def test_cold_advisory_triggers_only_below_threshold() -> None:
    above = build_advisories(_forecast([DayForecast("Today", 20.0, 10.1, "Clear sky")]))
    assert above.advisories == []
    at = build_advisories(_forecast([DayForecast("Today", 20.0, 10.0, "Clear sky")]))
    assert any("cold" in a.title.casefold() for a in at.advisories)


def test_missing_temperatures_never_trigger_temperature_rules() -> None:
    bundle = build_advisories(
        _forecast(
            [DayForecast("Today", None, None, "Mist"), DayForecast("Tomorrow", None, None, "Haze")]
        )
    )
    assert bundle.advisories == []


def test_rain_and_heat_can_coexist() -> None:
    bundle = build_advisories(
        _forecast(
            [
                DayForecast("Today", 40.0, 28.0, "Thunderstorm"),
                DayForecast("Tomorrow", 39.0, 27.0, "Hot and humid"),
            ]
        )
    )
    titles = [a.title.casefold() for a in bundle.advisories]
    assert any("rain" in t for t in titles)
    assert any("heat" in t for t in titles)


# ---------------------------------------------------------------------------
# IMD response parsing
# ---------------------------------------------------------------------------


def test_extract_days_maps_imd_field_names() -> None:
    payload: dict[str, Any] = {
        "Todays_Forecast": "Light rain",
        "Todays_Forecast_Max_Temp": "31.5",
        "Todays_Forecast_Min_temp": "25.0",
        "Day_2": "Generally cloudy sky",
        "Day_2_Max_Temp": "32.0",
        "Day_2_Min_temp": "26.0",
    }
    days = _extract_days(payload)
    assert [d.label for d in days] == ["Today", "Day 2"]
    assert days[0].max_temp_c == 31.5
    assert days[0].weather == "Light rain"


def test_extract_days_drops_empty_days() -> None:
    payload = {
        "Todays_Forecast": "Clear sky",
        "Todays_Forecast_Max_Temp": "30",
        "Todays_Forecast_Min_temp": "24",
        "Day_3": "",
        "Day_3_Max_Temp": "",
        "Day_3_Min_temp": "",
    }
    days = _extract_days(payload)
    assert [d.label for d in days] == ["Today"]


def test_fetch_requires_key(monkeypatch: pytest.MonkeyPatch) -> None:
    clear_cache()
    monkeypatch.setattr(get_settings(), "imd_api_key", "")
    with pytest.raises(ImdUnavailableError):
        fetch_city_forecast(station_for_region("Maharashtra"))


def test_fetch_parses_wrapped_response(monkeypatch: pytest.MonkeyPatch) -> None:
    clear_cache()

    class _Response:
        status_code = 200

        def json(self) -> dict[str, Any]:
            return {
                "status": True,
                "data": [
                    {
                        "Station_Code": "43003",
                        "Station_Name": "Mumbai",
                        "Date": "2026-09-23",
                        "Todays_Forecast": "Light to moderate rain",
                        "Todays_Forecast_Max_Temp": "30.2",
                        "Todays_Forecast_Min_temp": "26.1",
                    }
                ],
            }

    import app.weather.imd as imd

    monkeypatch.setattr(get_settings(), "imd_api_key", "test-key")
    monkeypatch.setattr(imd.httpx, "get", lambda *a, **kw: _Response())

    station = station_for_region("Maharashtra")
    assert station is not None
    forecast = fetch_city_forecast(station)
    assert forecast.station_name == "Mumbai"
    assert forecast.days[0].weather == "Light to moderate rain"
    assert forecast.days[0].max_temp_c == 30.2

    # Second call is served from cache without hitting httpx again.
    monkeypatch.setattr(
        imd.httpx, "get", lambda *a, **kw: (_ for _ in ()).throw(AssertionError("cache miss"))
    )
    again = fetch_city_forecast(station)
    assert again is forecast
    clear_cache()


def test_fetch_treats_429_as_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    clear_cache()

    class _Response:
        status_code = 429
        text = "rate limited"

        def json(self) -> dict[str, Any]:  # pragma: no cover - not reached
            return {}

    import app.weather.imd as imd

    monkeypatch.setattr(get_settings(), "imd_api_key", "test-key")
    monkeypatch.setattr(imd.httpx, "get", lambda *a, **kw: _Response())
    with pytest.raises(ImdUnavailableError):
        fetch_city_forecast(station_for_region("Maharashtra"))
    clear_cache()
