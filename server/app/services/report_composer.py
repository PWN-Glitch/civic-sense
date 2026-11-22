"""Report Composer.

Composes concise, structured letters from report observations without fake details.
"""

from __future__ import annotations

from typing import Any

CATEGORY_LABELS = {
    "pothole": "pothole",
    "streetlight": "streetlight outage",
    "trash": "missed trash / dumping",
    "graffiti": "graffiti",
    "sidewalk damage": "sidewalk damage",
    "other": "issue",
}


def _get(report: dict[str, Any], *path: str, default: Any = None) -> Any:
    cur: Any = report
    for key in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(key)
    return cur if cur is not None else default


def compose_subject(universal_report: dict[str, Any]) -> str:
    category = _get(universal_report, "issue", "category", default="other")
    label = CATEGORY_LABELS.get(category, "issue")
    jurisdiction = _get(universal_report, "location", "jurisdiction")
    where = f" in {jurisdiction}" if jurisdiction else ""
    # No "URGENT:" prefix. Severity is a model inference, and shouting it in
    # the subject line states as fact what the body already calls an estimate.
    return f"Civic issue report: {label}{where}"


def _location_line(universal_report: dict[str, Any]) -> str | None:
    loc = universal_report.get("location", {}) or {}
    address = loc.get("address")
    lat = loc.get("lat")
    lng = loc.get("lng")
    if address and lat is not None and lng is not None:
        return f"Location: {address} ({lat}, {lng})"
    if address:
        return f"Location: {address}"
    if lat is not None and lng is not None:
        return f"Location: {lat}, {lng}"
    return None


def _description_line(universal_report: dict[str, Any]) -> str | None:
    desc = (_get(universal_report, "issue", "description", default="") or "").strip()
    return f"Description: {desc}" if desc else None


def _observation_lines(universal_report: dict[str, Any]) -> list[str]:
    """Model-derived lines, only emitted when the IR carries the data.

    "Reported" and "Estimated" do the provenance work that a parenthetical tag
    used to: the category was confirmed by the reporter, the severity never was.
    """
    lines: list[str] = []
    category = _get(universal_report, "issue", "category")
    if category:
        lines.append(f"Reported category: {category}")
    severity = _get(universal_report, "issue", "severity")
    if severity:
        lines.append(f"Estimated severity: {severity}")
    return lines


def _evidence_line(universal_report: dict[str, Any]) -> str | None:
    evidence = universal_report.get("evidence") or []
    if not evidence:
        return None
    n = len(evidence)
    noun = "photo" if n == 1 else "photos"
    return f"{n} {noun} attached."


def _disclosure_line(universal_report: dict[str, Any]) -> str | None:
    """One sentence, in the letter's own voice, naming what the model added.

    Only emitted when there is something to disclose, and it says "from the
    attached photo" only when a photo is actually attached.
    """
    if not _get(universal_report, "issue", "severity"):
        return None
    from_photo = " from the attached photo" if universal_report.get("evidence") else ""
    return (
        f"Severity was estimated by Civic Sense{from_photo}; "
        "the location and issue details above are what I reported."
    )


def _request_line(universal_report: dict[str, Any]) -> str:
    department = _get(universal_report, "responsibility", "department")
    category = _get(universal_report, "issue", "category", default="other")
    label = CATEGORY_LABELS.get(category, "issue")
    if department:
        return f"Request: Please route this {label} report to {department} and update me on its status."
    return f"Request: Please investigate this {label} report and update me on its status."


def compose_body(universal_report: dict[str, Any]) -> str:
    facts = [
        _location_line(universal_report),
        _description_line(universal_report),
        *_observation_lines(universal_report),
        _evidence_line(universal_report),
    ]
    lines: list[str] = [
        "To whom it may concern,",
        "",
        "I'm reporting a civic issue and would like it routed to the right team.",
        "",
        *(fact for fact in facts if fact),
        "",
        _request_line(universal_report),
    ]
    disclosure = _disclosure_line(universal_report)
    if disclosure:
        lines += ["", disclosure]
    lines += ["", "Thank you,", "A resident"]
    return "\n".join(lines)


def compose(universal_report: dict[str, Any], tone: str | None = None) -> dict[str, str]:
    """Build {subject, body} from the Universal Report IR. Tone is reserved for
    a future pass; the output stays factual and concise regardless."""
    return {
        "subject": compose_subject(universal_report),
        "body": compose_body(universal_report),
    }


# ---- regenerate ----


_BOILERPLATE = frozenset(
    {
        "To whom it may concern,",
        "I'm reporting a civic issue and would like it routed to the right team.",
        "Thank you,",
        "A resident",
    }
)


def _shorter(text: str) -> str:
    """Drop the letter's greeting, preamble and sign-off, keep every fact, the
    request, and the disclosure.

    The disclosure is the honesty floor, so "make shorter" never removes it —
    a shorter letter still says which claim the model contributed.
    """
    keep: list[str] = []
    for line in text.splitlines():
        if line.strip() in _BOILERPLATE:
            continue
        keep.append(line)
    # collapse runs of blank lines
    out: list[str] = []
    prev_blank = False
    for line in keep:
        blank = not line.strip()
        if blank and prev_blank:
            continue
        out.append(line)
        prev_blank = blank
    return "\n".join(out).strip()


def _more_detailed(universal_report: dict[str, Any], current: str) -> str:
    """Re-compose in full — greeting, every fact, the request, the disclosure.
    The most detailed factual rendering we can make without inventing anything."""
    return compose_body(universal_report)


def regenerate(
    universal_report: dict[str, Any],
    *,
    section: str,
    instruction: str,
    current_text: str,
    correction: str | None = None,
) -> str:
    """Produce new text for one section. Never touches the other section and
    never fabricates content; `correct` requires an explicit user correction.
    """
    if instruction == "correct":
        if not correction or not correction.strip():
            raise ValueError("correct requires a non-empty correction")
        return correction.strip()

    if section == "subject":
        base = compose_subject(universal_report)
        if instruction == "make_shorter":
            category = _get(universal_report, "issue", "category", default="other")
            return f"Civic issue: {CATEGORY_LABELS.get(category, 'issue')}"
        return base

    # section == "body"
    if instruction == "make_shorter":
        return _shorter(current_text or compose_body(universal_report))
    if instruction == "make_more_detailed":
        return _more_detailed(universal_report, current_text)
    # default: re-compose
    return compose_body(universal_report)
