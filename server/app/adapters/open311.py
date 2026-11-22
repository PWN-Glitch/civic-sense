"""Open311 GeoReport v2 read adapter (Chicago, Bloomington).

Write path is only enabled if an api_key is configured; otherwise we return the
services endpoint as a deeplink-style reference. We NEVER claim submission
succeeded unless the upstream API confirms it.
"""

from __future__ import annotations

from typing import Any

from app.adapters.base import CATEGORY_TO_DEPARTMENT, RouteResult


class Open311Adapter:
    """Generic read adapter for Open311 GeoReport v2 endpoints."""

    def __init__(
        self,
        *,
        jurisdiction_id: str,
        name: str,
        bbox: tuple[float, float, float, float],
        endpoint: str,
        api_key: str | None = None,
    ) -> None:
        self.jurisdiction_id = jurisdiction_id
        self.name = name
        self.bbox = bbox
        self.endpoint = endpoint.rstrip("/")
        self.api_key = api_key

    def contains(self, lat: float, lng: float) -> bool:
        min_lng, min_lat, max_lng, max_lat = self.bbox
        return min_lat <= lat <= max_lat and min_lng <= lng <= max_lng

    def department_for(self, category: str) -> str:
        return CATEGORY_TO_DEPARTMENT.get(category, "General")

    def services_url(self) -> str:
        return f"{self.endpoint}/services.json"

    def route(self, report: dict[str, Any]) -> RouteResult:
        category = report.get("category", "other")
        payload = {
            "category": category,
            "description": report.get("description", ""),
            "lat": report.get("lat"),
            "lng": report.get("lng"),
            "services_url": self.services_url(),
        }
        return RouteResult(
            method="api",
            url=self.services_url(),
            payload=payload,
            department=self.department_for(category),
            disclaimer=(
                f"{self.name} exposes a live Open311 GeoReport v2 endpoint. "
                "Review the pre-filled payload and confirm submission on the official endpoint."
            ),
        )
