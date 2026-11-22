"""Jurisdiction adapter protocol."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

CHANNEL_TYPES = (
    "OPEN311",
    "API",
    "EMAIL",
    "PHONE",
    "WEB_FORM",
    "GOVERNMENT_PORTAL",
    "MOBILE_APP",
    "IN_PERSON",
    "MANUAL",
)


@dataclass
class SubmissionChannel:
    """Channel definition for submitting a report."""

    type: str  # one of CHANNEL_TYPES
    destination: str | None = None
    confidence: float = 0.0
    reasons: list[str] = field(default_factory=list)
    source_url: str | None = None
    verification_status: str = "unknown"  # verified | likely | unverified | unknown
    requires: dict[str, Any] = field(default_factory=dict)


@dataclass
class RouteResult:
    method: Literal["api", "deeplink"]
    department: str
    disclaimer: str
    url: str | None = None
    payload: dict[str, Any] | None = field(default=None)
    # Additive, back-compatible: old fields unchanged; channels/universal_report
    # default empty so existing /routing/resolve consumers are unaffected.
    channels: list[SubmissionChannel] = field(default_factory=list)
    universal_report: Any | None = field(default=None)


class JurisdictionAdapter(Protocol):
    """Contract every jurisdiction adapter satisfies."""

    name: str
    jurisdiction_id: str
    bbox: tuple[float, float, float, float]  # (min_lng, min_lat, max_lng, max_lat)

    def contains(self, lat: float, lng: float) -> bool: ...

    def route(self, report: dict[str, Any]) -> RouteResult: ...

    def department_for(self, category: str) -> str: ...


# Department mapping:
CATEGORY_TO_DEPARTMENT: dict[str, str] = {
    "pothole": "Transportation",
    "streetlight": "Utilities",
    "trash": "Sanitation",
    "graffiti": "Public Works",
    "sidewalk damage": "Transportation",
    "other": "General",
}
