"""Reporting Requirements Engine.

Identifies missing required fields without inventing fake values.
"""

from __future__ import annotations

from typing import Any

# Per-channel baseline requirements:
_CHANNEL_DEFAULTS: dict[str, list[str]] = {
    "EMAIL": ["description", "location"],
    "PHONE": ["description", "location"],
    "WEB_FORM": ["description", "location"],
    "GOVERNMENT_PORTAL": ["description", "location"],
    "OPEN311": ["location"],
    "API": ["location"],
    "MOBILE_APP": ["description", "location"],
    "IN_PERSON": ["location"],
    "MANUAL": ["description", "location"],
}

# Human-readable copy for each known field (§20 example copy).
_FIELD_LABELS: dict[str, str] = {
    "description": "a short description of the issue",
    "location": "the issue location",
    "address": "a street address",
    "photo": "at least one photo",
    "category": "an issue category",
    "severity": "a severity level",
    "contact_name": "your name",
    "contact_email": "your email address",
    "contact_phone": "your phone number",
}


def required_fields(
    channel: dict[str, Any] | None, category: str, jurisdiction: str | None
) -> list[str]:
    """Union of channel defaults + the contact's declared ``requires``.

    ``channel`` may be a SubmissionChannel-shaped dict with a ``requires`` key
    (which may be a list of field names or a dict with a ``fields`` list).
    """
    channel_type = (channel or {}).get("type", "MANUAL") if isinstance(channel, dict) else "MANUAL"
    fields: list[str] = list(_CHANNEL_DEFAULTS.get(channel_type, ["description", "location"]))

    requires = (channel or {}).get("requires") if isinstance(channel, dict) else None
    extra: list[str] = []
    if isinstance(requires, list):
        extra = [str(x) for x in requires]
    elif isinstance(requires, dict):
        raw = requires.get("fields", [])
        if isinstance(raw, list):
            extra = [str(x) for x in raw]

    for f in extra:
        if f not in fields:
            fields.append(f)
    return fields


def _present(universal_report: dict[str, Any], field: str) -> bool:
    issue = universal_report.get("issue", {})
    location = universal_report.get("location", {})
    evidence = universal_report.get("evidence") or []
    if field == "description":
        return bool((issue.get("description") or "").strip())
    if field == "location":
        return location.get("lat") is not None and location.get("lng") is not None
    if field == "address":
        return bool((location.get("address") or "").strip())
    if field == "photo":
        return len(evidence) > 0
    if field == "category":
        return bool((issue.get("category") or "").strip())
    if field == "severity":
        return bool((issue.get("severity") or "").strip())
    # contact_name / contact_email / contact_phone live outside the IR for now;
    # treat them as absent unless explicitly carried under a ``contact`` key.
    contact = universal_report.get("contact", {})
    if field.startswith("contact_"):
        return bool((contact.get(field.removeprefix("contact_")) or "").strip())
    return False


def missing_fields(universal_report: dict[str, Any], required: list[str]) -> list[str]:
    """Human-readable gap list for the required fields the report is missing."""
    gaps: list[str] = []
    for f in required:
        if not _present(universal_report, f):
            label = _FIELD_LABELS.get(f, f.replace("_", " "))
            gaps.append(f"Add {label}.")
    return gaps


def missing_field_keys(universal_report: dict[str, Any], required: list[str]) -> list[str]:
    """Machine-readable names for missing required fields."""
    return [field.lower() for field in required if not _present(universal_report, field)]
