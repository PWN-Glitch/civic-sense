"""Requirements engine: required_fields + missing_fields gap copy."""

from __future__ import annotations

from app.services.requirements import missing_field_keys, missing_fields, required_fields


def _report(**over) -> dict:
    base = {
        "issue": {"category": "pothole", "description": "", "severity": "low"},
        "location": {"lat": 39.2904, "lng": -76.6122, "address": None, "jurisdiction": "Baltimore"},
        "evidence": [],
    }
    for k, v in over.items():
        base[k].update(v) if isinstance(v, dict) else base.__setitem__(k, v)
    return base


def test_web_form_requires_description_and_location() -> None:
    fields = required_fields({"type": "WEB_FORM", "requires": {}}, "pothole", "Baltimore")
    assert "description" in fields
    assert "location" in fields


def test_contact_requires_merge_in_extra_fields() -> None:
    ch = {"type": "WEB_FORM", "requires": {"fields": ["photo", "address"]}}
    fields = required_fields(ch, "pothole", "Baltimore")
    assert "photo" in fields and "address" in fields


def test_requires_as_list_also_supported() -> None:
    fields = required_fields({"type": "EMAIL", "requires": ["contact_email"]}, "trash", None)
    assert "contact_email" in fields


def test_missing_description_flagged() -> None:
    gaps = missing_fields(_report(), required_fields({"type": "WEB_FORM"}, "pothole", "Baltimore"))
    assert any("description" in g for g in gaps)


def test_present_fields_not_flagged() -> None:
    r = _report(issue={"description": "Pothole on Main"})
    gaps = missing_fields(r, required_fields({"type": "WEB_FORM"}, "pothole", "Baltimore"))
    assert not any("description" in g for g in gaps)
    assert not any("location" in g for g in gaps)  # lat/lng present


def test_missing_photo_flagged_when_required() -> None:
    gaps = missing_fields(_report(), required_fields({"type": "WEB_FORM", "requires": ["photo"]}, "pothole", "Baltimore"))
    assert any("photo" in g for g in gaps)
    # With a photo, the gap closes.
    r2 = _report(evidence=["p1"])
    gaps2 = missing_fields(r2, required_fields({"type": "WEB_FORM", "requires": ["photo"]}, "pothole", "Baltimore"))
    assert not any("photo" in g for g in gaps2)


def test_gap_copy_is_human_readable() -> None:
    gaps = missing_fields(_report(), required_fields({"type": "WEB_FORM", "requires": ["photo"]}, "pothole", "Baltimore"))
    for g in gaps:
        assert g.startswith("Add ") and g.endswith(".")


def test_missing_field_keys_are_machine_readable() -> None:
    required = required_fields(
        {"type": "WEB_FORM", "requires": ["photo"]}, "pothole", "Baltimore"
    )
    keys = missing_field_keys(_report(), required)
    assert keys == ["description", "photo"]


def test_open311_only_needs_location_by_default() -> None:
    fields = required_fields({"type": "OPEN311", "requires": {}}, "pothole", "Chicago")
    assert "location" in fields and "description" not in fields
