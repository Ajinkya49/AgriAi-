"""Resolving a farmer's region to IMD weather data.

The app's `users.region` is an Indian state or UT (the onboarding picker — see
`frontend/lib/validation/auth.ts` → `INDIAN_STATES`). IMD's city forecast is
keyed by station, so this module maps each state to a representative IMD
station — the state capital, which is where IMD's densest, most reliable city
observations are.

Deliberate limitation, recorded rather than hidden: a state is not a district.
Advisories below are therefore marked "for the {region} area" and the UI says
the same, so a farmer in Vidarbha is never told the forecast is *for their
field*. District-level resolution needs the `cityforecast_mapping` dataset keyed
by district, which is a later refinement that does not change this module's
shape.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Station:
    """One IMD city-forecast station."""

    code: str  # IMD `Station_Code`, as used by `cityforecast?id=<code>`
    name: str
    lat: float
    lon: float


# State/UT name exactly as offered by the onboarding picker → the IMD city
# station a forecast for that state is drawn from. Keys are matched
# case-insensitively at lookup time.
_STATE_STATIONS: dict[str, Station] = {
    "Andhra Pradesh": Station("43125", "Vijayawada", 16.51, 80.65),
    "Arunachal Pradesh": Station("42314", "Itanagar", 27.08, 93.61),
    "Assam": Station("42737", "Guwahati", 26.14, 91.74),
    "Bihar": Station("42486", "Patna", 25.61, 85.14),
    "Chhattisgarh": Station("42867", "Raipur", 21.23, 81.65),
    "Goa": Station("43291", "Panaji", 15.49, 73.83),
    "Gujarat": Station("42647", "Gandhinagar", 23.22, 72.65),
    "Haryana": Station("42182", "Chandigarh", 30.73, 76.78),
    "Himachal Pradesh": Station("42071", "Shimla", 31.10, 77.17),
    "Jharkhand": Station("42894", "Ranchi", 23.34, 85.44),
    "Karnataka": Station("43295", "Bengaluru", 12.97, 77.59),
    "Kerala": Station("43353", "Thiruvananthapuram", 8.52, 76.94),
    "Madhya Pradesh": Station("42867", "Bhopal", 23.26, 77.41),
    "Maharashtra": Station("43003", "Mumbai", 19.08, 72.88),
    "Manipur": Station("43211", "Imphal", 24.82, 93.94),
    "Meghalaya": Station("42739", "Shillong", 25.57, 91.88),
    "Mizoram": Station("42795", "Aizawl", 23.73, 92.72),
    "Nagaland": Station("42545", "Kohima", 25.67, 94.11),
    "Odisha": Station("43086", "Bhubaneswar", 20.30, 85.82),
    "Punjab": Station("42182", "Chandigarh", 30.73, 76.78),
    "Rajasthan": Station("42369", "Jaipur", 26.92, 75.79),
    "Sikkim": Station("42422", "Gangtok", 27.33, 88.62),
    "Tamil Nadu": Station("43321", "Chennai", 13.08, 80.27),
    "Telangana": Station("43121", "Hyderabad", 17.38, 78.47),
    "Tripura": Station("42747", "Agartala", 23.83, 91.28),
    "Uttar Pradesh": Station("42295", "Lucknow", 26.85, 80.95),
    "Uttarakhand": Station("42111", "Dehradun", 30.32, 78.03),
    "West Bengal": Station("42807", "Kolkata", 22.57, 88.36),
    "Andaman and Nicobar Islands": Station("43333", "Port Blair", 11.62, 92.73),
    "Chandigarh": Station("42182", "Chandigarh", 30.73, 76.78),
    "Dadra and Nagar Haveli and Daman and Diu": Station("42800", "Silvassa", 20.27, 73.02),
    "Delhi": Station("42182", "New Delhi", 28.61, 77.21),
    "Jammu and Kashmir": Station("42026", "Srinagar", 34.08, 74.80),
    "Ladakh": Station("42020", "Leh", 34.16, 77.58),
    "Lakshadweep": Station("43369", "Kavaratti", 10.57, 72.64),
    "Puducherry": Station("43311", "Puducherry", 11.94, 79.83),
}

# Deliberate misspellings/tolerances are not needed for a picker-driven value,
# but `region` is free text in the schema and older rows may differ in case or
# whitespace. Normalise defensively rather than returning nothing.
_LOOKUP: dict[str, Station] = {
    key.strip().casefold(): station for key, station in _STATE_STATIONS.items()
}


def station_for_region(region: str | None) -> Station | None:
    """The IMD station representing `region`, or None when unresolvable.

    Case- and whitespace-insensitive. A free-text region that is not an Indian
    state (or is empty) has no honest forecast, so this returns None and the
    caller reports `region_unresolved` rather than guessing a city.
    """
    if not region or not region.strip():
        return None
    return _LOOKUP.get(region.strip().casefold())
