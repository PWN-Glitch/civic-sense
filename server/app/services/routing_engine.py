"""Jurisdiction resolution: GPS → first matching adapter by bbox → generic fallback."""

from __future__ import annotations

import json
from functools import lru_cache
from importlib import resources
from typing import Any

from app.adapters.base import CATEGORY_TO_DEPARTMENT, JurisdictionAdapter, RouteResult
from app.adapters.baltimore import BaltimoreAdapter
from app.adapters.open311 import Open311Adapter


class GenericAdapter:
    """Fallback when no jurisdiction matches. Never fabricates submission."""

    name = "Generic"
    jurisdiction_id = "generic"
    bbox = (-180.0, -90.0, 180.0, 90.0)

    def contains(self, lat: float, lng: float) -> bool:
        return True

    def department_for(self, category: str) -> str:
        return CATEGORY_TO_DEPARTMENT.get(category, "General")

    def route(self, report: dict[str, Any]) -> RouteResult:
        category = report.get("category", "other")
        return RouteResult(
            method="deeplink",
            url="https://www.usa.gov/local-governments",
            payload={"category": category, "lat": report.get("lat"), "lng": report.get("lng")},
            department=self.department_for(category),
            disclaimer=(
                "No supported jurisdiction at this location. "
                "Contact your local government to submit this report."
            ),
        )


@lru_cache(maxsize=1)
def _load_adapters() -> list[JurisdictionAdapter]:
    """Load jurisdictions.json once and build adapters."""
    with resources.files("app.data").joinpath("jurisdictions.json").open("r") as f:
        configs: list[dict[str, Any]] = json.load(f)

    adapters: list[JurisdictionAdapter] = []
    for cfg in configs:
        adapter_type = cfg["adapter_type"]
        bbox = tuple(cfg["bbox"])  # (min_lng, min_lat, max_lng, max_lat)
        if adapter_type == "baltimore_deeplink":
            adapters.append(BaltimoreAdapter())
        elif adapter_type == "open311":
            adapters.append(
                Open311Adapter(
                    jurisdiction_id=cfg["id"],
                    name=cfg["name"],
                    bbox=bbox,  # type: ignore[arg-type]
                    endpoint=cfg["adapter_config"]["endpoint"],
                )
            )
    return adapters


def resolve(lat: float, lng: float) -> JurisdictionAdapter:
    """First adapter whose bbox contains the point, else generic."""
    for adapter in _load_adapters():
        if adapter.contains(lat, lng):
            return adapter
    return GenericAdapter()
