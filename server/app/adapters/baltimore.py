"""Baltimore adapter — SeeClickFix + deep-link to baltimorecity.gov/311.

Baltimore's own Open311 endpoint is dead (verified 2026-10 in spec). Do NOT
architect around it. We return a deep-link plus a pre-filled payload the client
can hand to the web form. We NEVER claim submission succeeded.
"""

from __future__ import annotations

from typing import Any

from app.adapters.base import CATEGORY_TO_DEPARTMENT, RouteResult

_BBOX = (-76.7117, 39.1972, -76.5294, 39.3720)  # (min_lng, min_lat, max_lng, max_lat)
_DEEPLINK = "https://www.baltimorecity.gov/311"
_SEECLICKFIX = "https://seeclickfix.com/baltimore"


class BaltimoreAdapter:
    name = "Baltimore"
    jurisdiction_id = "baltimore"
    bbox = _BBOX

    def contains(self, lat: float, lng: float) -> bool:
        min_lng, min_lat, max_lng, max_lat = self.bbox
        return min_lat <= lat <= max_lat and min_lng <= lng <= max_lng

    def department_for(self, category: str) -> str:
        return CATEGORY_TO_DEPARTMENT.get(category, "General")

    def route(self, report: dict[str, Any]) -> RouteResult:
        category = report.get("category", "other")
        payload = {
            "category": category,
            "description": report.get("description", ""),
            "lat": report.get("lat"),
            "lng": report.get("lng"),
            "seeclickfix_note": f"Baltimore also accepts reports via SeeClickFix: {_SEECLICKFIX}",
        }
        return RouteResult(
            method="deeplink",
            url=_DEEPLINK,
            payload=payload,
            department=self.department_for(category),
            disclaimer="Opens Baltimore's official 311 — submit there to complete.",
        )
