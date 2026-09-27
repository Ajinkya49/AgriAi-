"""Farming advisories derived from an IMD forecast.

Rules, not an LLM. Three reasons, all the same reason:

1. **Constraint #1** — the LLM lives in `app/rag/` and never anywhere else; the
   weather feature must not become a second place a language model is consulted.
2. **A forecast advisory must never hallucinate.** "Spray before it rains" is a
   deterministic consequence of "rain is forecast"; if a model paraphrased it,
   the app would need its own grounding checks on output that is already
   grounded by construction.
3. **Testable.** Every rule below is a pure function of the forecast, so the
   suite can pin each one's trigger *and* its non-trigger case.

Rule thresholds are conventional agronomy triggers, stated plainly in the UI so
a farmer (or their KVK officer) can judge them. They are guidance, not
treatment advice — solutions remain the curated `solutions` table's job.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.weather.imd import CityForecast, DayForecast

# Rain language IMD actually uses in `*_Forecast` free text. Matching on a
# keyword list is deliberately conservative — it under-detects rather than
# over-triggers a spray warning, which is the safe direction.
_RAIN_WORDS = ("rain", "drizzle", "shower", "thunderstorm", "thundershower")

# Extended forecast labels, in English and Hindi. A farmer reading outdoors
# gets the Hindi alongside rather than needing a language toggle.
_RAIN_LABEL_EN = "Rain likely"
_RAIN_LABEL_HI = "बारिश की संभावना"

_HEAT_LABEL_EN = "Heat stress likely"
_HEAT_LABEL_HI = "गर्मी का खतरा"

_COLD_LABEL_EN = "Cold stress likely"
_COLD_LABEL_HI = "सर्दी का खतरा"

# Conventional agronomy thresholds, in °C. Heat: sustained > 37 °C stresses
# flowering and fruit set in tomato/pepper/potato. Cold: < 10 °C slows growth
# and favours late-blight-type pressures in cool-wet weather.
_HEAT_THRESHOLD_C = 37.0
_COLD_THRESHOLD_C = 10.0

# Wind speeds are not in the city-forecast product (they are in `current_wx`,
# keyed to observation stations), so no wind rule can be honestly derived here.
# If the city product ever gains wind fields, a drift rule belongs below the
# rain rule and keyed to the same day labels.


@dataclass(frozen=True)
class Advisory:
    """One actionable line, plus the day(s) it concerns."""

    title: str
    title_hi: str
    detail: str
    detail_hi: str
    day_labels: list[str]  # e.g. ["Tomorrow", "Day 3"]


@dataclass(frozen=True)
class AdvisoryBundle:
    """Everything the weather screen renders for one location."""

    advisories: list[Advisory]
    rain_expected: bool


def _mentions_rain(text: str) -> bool:
    needle = text.casefold()
    return any(word in needle for word in _RAIN_WORDS)


def _first_rain_days(days: list[DayForecast]) -> list[DayForecast]:
    return [d for d in days if _mentions_rain(d.weather)]


def _first_heat_days(days: list[DayForecast]) -> list[DayForecast]:
    return [d for d in days if d.max_temp_c is not None and d.max_temp_c >= _HEAT_THRESHOLD_C]


def _first_cold_days(days: list[DayForecast]) -> list[DayForecast]:
    return [d for d in days if d.min_temp_c is not None and d.min_temp_c <= _COLD_THRESHOLD_C]


def build_advisories(forecast: CityForecast) -> AdvisoryBundle:
    """Derive all advisories from one forecast.

    Order is deliberate: rain first (spray timing is the highest-value
    warning), then heat, then cold. An empty list is a valid result — a benign
    forecast needs no card, and the UI renders "no alerts" text for that.
    """
    advisories: list[Advisory] = []
    days = forecast.days

    rain_days = _first_rain_days(days)
    if rain_days:
        labels = [d.label for d in rain_days[:3]]
        detail = (
            "Rain is forecast. Finish any spraying before it starts — "
            "rain washes spray off before it works. Check drainage in low-lying beds."
        )
        detail_hi = (
            "बारिश की संभावना है। छिड़काव बारिश से पहले पूरा करें — "
            "बारिश दवा को बहा देती है। खेत की नालियाँ साफ़ रखें।"
        )
        advisories.append(
            Advisory(
                title=_RAIN_LABEL_EN,
                title_hi=_RAIN_LABEL_HI,
                detail=detail,
                detail_hi=detail_hi,
                day_labels=labels,
            )
        )

    heat_days = _first_heat_days(days)
    if heat_days:
        labels = [d.label for d in heat_days[:3]]
        peak = max(d.max_temp_c for d in heat_days if d.max_temp_c is not None)
        advisories.append(
            Advisory(
                title=_HEAT_LABEL_EN,
                title_hi=_HEAT_LABEL_HI,
                detail=(
                    f"Day temperatures may reach {peak:.0f}°C. Water early morning or "
                    "evening, mulch beds to hold moisture, and avoid transplanting in "
                    "this window."
                ),
                detail_hi=(
                    f"दिन का तापमान {peak:.0f}°C तक जा सकता है। सुबह या शाम को पानी दें, "
                    "मल्चिंग करें, और इस समय रोपाई से बचें।"
                ),
                day_labels=labels,
            )
        )

    cold_days = _first_cold_days(days)
    if cold_days:
        labels = [d.label for d in cold_days[:3]]
        low = min(d.min_temp_c for d in cold_days if d.min_temp_c is not None)
        advisories.append(
            Advisory(
                title=_COLD_LABEL_EN,
                title_hi=_COLD_LABEL_HI,
                detail=(
                    f"Nights may fall to {low:.0f}°C. Young plants and nurseries are "
                    "most affected — consider overnight cover, and go easy on nitrogen "
                    "until it warms."
                ),
                detail_hi=(
                    f"रात का तापमान {low:.0f}°C तक गिर सकता है। कोप्पले और नर्सरी "
                    "सबसे ज़्यादा प्रभावित होते हैं — रात में ढकने पर विचार करें।"
                ),
                day_labels=labels,
            )
        )

    return AdvisoryBundle(advisories=advisories, rain_expected=bool(rain_days))
