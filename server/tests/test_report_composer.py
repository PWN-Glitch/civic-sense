"""Report Composer: provenance in prose, no invented observations, regenerate."""

from __future__ import annotations

import pytest

from app.services.report_composer import compose, regenerate


def _report(**over) -> dict:
    base = {
        "issue": {"category": "pothole", "subcategory": None, "description": "", "severity": "low"},
        "location": {"lat": 39.2904, "lng": -76.6122, "address": None, "jurisdiction": "Baltimore"},
        "evidence": [],
        "responsibility": {"organization": "Baltimore", "department": "Transportation", "confidence": 0.8, "reasons": []},
        "submission": {"method": "WEB_FORM", "destination": "https://x", "source": "https://x"},
        "report": {"subject": "", "body": ""},
        "verification": {"user_approved": False},
    }
    for k, v in over.items():
        base[k].update(v) if isinstance(base.get(k), dict) and isinstance(v, dict) else base.__setitem__(k, v)
    return base


def test_compose_discloses_ai_contribution_once() -> None:
    r = _report(issue={"description": "Big pothole on Main St."}, evidence=["p1", "p2"])
    body = compose(r)["body"]
    # Prompt-trace notation never reaches the city: the letter reads as prose.
    for tag in ("USER PROVIDED", "AI OBSERVED", "AI INFERRED", "UNKNOWN", "(AI"):
        assert tag not in body
    assert "Big pothole on Main St." in body
    assert "2 photos attached" in body
    assert "Reported category: pothole" in body
    assert "Estimated severity: low" in body
    # One sentence of disclosure, in the letter's own voice.
    assert body.count("Civic Sense") == 1
    assert "from the attached photo" in body
    assert "location and issue details above are what I reported" in body
    assert "everything else is as I reported" not in body


def test_compose_omits_missing_fields_instead_of_inventing() -> None:
    body = compose(_report())["body"]  # empty description, no photos
    assert "Description:" not in body
    assert "attached" not in body
    # No fabricated prose about the issue.
    assert "large" not in body.lower()
    assert "dangerous" not in body.lower()


def test_compose_disclosure_skips_photo_claim_when_no_photo() -> None:
    body = compose(_report(issue={"severity": "high"}))["body"]
    assert "Estimated severity: high" in body
    assert "from the attached photo" not in body


def test_compose_says_nothing_to_disclose_without_an_estimate() -> None:
    r = _report()
    r["issue"].pop("severity")
    assert "Civic Sense" not in compose(r)["body"]


def test_compose_subject_includes_category_and_jurisdiction() -> None:
    out = compose(_report())
    assert "pothole" in out["subject"]
    assert "Baltimore" in out["subject"]


def test_compose_high_severity_does_not_shout_in_the_subject() -> None:
    # Severity is inferred, so it stays in the body where it is called an
    # estimate; the subject carries no urgency claim of its own.
    out = compose(_report(issue={"severity": "high"}))
    assert "urgent" not in out["subject"].lower()
    assert "Estimated severity: high" in out["body"]


def test_compose_address_preferred_over_coords() -> None:
    out = compose(_report(location={"address": "100 N Holliday St"}))
    assert "Location: 100 N Holliday St" in out["body"]


def test_regenerate_make_shorter_drops_letter_framing_keeps_facts() -> None:
    r = _report(issue={"description": "Pothole."})
    full = compose(r)["body"]
    short = regenerate(r, section="body", instruction="make_shorter", current_text=full)
    assert "To whom it may concern," not in short
    assert "Thank you," not in short
    assert "Pothole." in short  # the reporter's fact survives
    assert "Request:" in short
    # The disclosure is not padding: the short letter still names the estimate.
    assert "Civic Sense" in short
    assert len(short) < len(full)


def test_regenerate_make_more_detailed_restores_full_letter() -> None:
    r = _report(issue={"description": "Pothole."})
    detailed = regenerate(r, section="body", instruction="make_more_detailed", current_text="x")
    assert "To whom it may concern," in detailed
    assert "Estimated severity: low" in detailed


def test_regenerate_correct_uses_user_text() -> None:
    out = regenerate(_report(), section="body", instruction="correct", current_text="old", correction="  Fixed text. ")
    assert out == "Fixed text."


def test_regenerate_correct_requires_correction() -> None:
    with pytest.raises(ValueError):
        regenerate(_report(), section="body", instruction="correct", current_text="old")


def test_regenerate_subject_shorter() -> None:
    r = _report()
    s = regenerate(r, section="subject", instruction="make_shorter", current_text="")
    assert s == "Civic issue: pothole"
