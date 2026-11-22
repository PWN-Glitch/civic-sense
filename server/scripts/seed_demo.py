"""Demo-data seeder for the Congressional App Challenge presentation.

Run from ``server/``:

    python -m scripts.seed_demo

Design notes
------------
* Uses the ORM directly (async session), NOT the HTTP API — the rate limiter
  and Google-auth dependency never come into play.
* Idempotent: every run first deletes any user whose ``google_sub`` starts
  with ``demo-``. SQLAlchemy's ``all, delete-orphan`` cascade on
  ``User.reports`` plus ``ON DELETE CASCADE`` on the FK columns removes their
  reports, ai_predictions, user_confirmations, status history, photos rows,
  and community votes in one shot. Real (non-demo) data is never touched.
* Every description carries a " (Demo report — simulated data)" suffix so the
  rows can never be mistaken for real 311 reports.
"""

from __future__ import annotations

import asyncio
import json
import random
import uuid
from datetime import UTC, datetime, timedelta
from importlib import resources

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import async_session
from app.models import (
    AiPrediction,
    CommunityVerification,
    Department,
    Jurisdiction,
    Photo,
    Report,
    ReportStatusHistory,
    User,
    UserConfirmation,
)
from app.services.labels import CATEGORIES

DEMO_SUB_PREFIX = "demo-"
DEMO_USER_SUB = "demo-user"
DEMO_NEIGHBOR_SUBS = ("demo-neighbor-1", "demo-neighbor-2", "demo-neighbor-3")
DEMO_SUFFIX = " (Demo report — simulated data)"
STATUS_LADDER = ["Draft", "Confirmed", "Submitted", "Acknowledged", "InProgress", "Resolved"]
MOBILENET_VERSION = "mobilenetv3-small-v1"


def _point_wkt(lng: float, lat: float) -> str:
    return f"SRID=4326;POINT({lng} {lat})"


# ---------------------------------------------------------------------------
# Wipe — only demo-tagged rows. Cascade does the rest.
# ---------------------------------------------------------------------------


async def wipe_demo_data(db: AsyncSession) -> int:
    """Delete demo users and everything they own. Returns users removed.

    The DB foreign keys have NO ``ON DELETE CASCADE``, so an ORM-unit-of-work
    delete is required: ``session.delete(user)`` issues SELECTs for the
    related rows and deletes children bottom-up via the ``all, delete-orphan``
    cascade on ``User.reports`` (and Report's own cascades to predictions,
    confirmations, status history, photos). ``community_verifications`` has
    no ORM cascade, so votes are deleted explicitly first — both votes cast
    BY demo users and votes cast ON demo users' reports.
    """
    demo_users = (
        (await db.execute(select(User).where(User.google_sub.like(f"{DEMO_SUB_PREFIX}%"))))
        .scalars()
        .all()
    )
    if not demo_users:
        return 0
    demo_ids = [u.id for u in demo_users]
    demo_report_ids = (
        (await db.execute(select(Report.id).where(Report.reporter_id.in_(demo_ids))))
        .scalars()
        .all()
    )
    await db.execute(
        delete(CommunityVerification).where(
            or_(
                CommunityVerification.user_id.in_(demo_ids),
                CommunityVerification.report_id.in_(demo_report_ids),
            )
        )
    )
    for user in demo_users:
        await db.delete(user)
    await db.commit()
    return len(demo_ids)


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


async def ensure_demo_users(db: AsyncSession) -> dict[str, User]:
    users: dict[str, User] = {}
    demo = User(id=str(uuid.uuid4()), google_sub=DEMO_USER_SUB, display_name="Demo Resident")
    db.add(demo)
    users[DEMO_USER_SUB] = demo
    for i, sub in enumerate(DEMO_NEIGHBOR_SUBS, start=1):
        u = User(id=str(uuid.uuid4()), google_sub=sub, display_name=f"Demo Neighbor {i}")
        db.add(u)
        users[sub] = u
    await db.flush()
    return users


# ---------------------------------------------------------------------------
# Jurisdiction + departments (idempotent upsert by name)
# ---------------------------------------------------------------------------


async def upsert_baltimore(db: AsyncSession) -> tuple[Jurisdiction, list[Department], bool, int]:
    """Insert or refresh the Baltimore jurisdiction row and its departments.

    Returns (jurisdiction, departments, jurisdiction_created, departments_added).
    """
    with resources.files("app.data").joinpath("jurisdictions.json").open("r") as f:
        configs = json.load(f)
    cfg = next(c for c in configs if c["id"] == "baltimore")

    min_lng, min_lat, max_lng, max_lat = cfg["bbox"]
    geo_boundary = {
        "type": "Polygon",
        "coordinates": [[
            [min_lng, min_lat],
            [max_lng, min_lat],
            [max_lng, max_lat],
            [min_lng, max_lat],
            [min_lng, min_lat],
        ]],
    }

    result = await db.execute(select(Jurisdiction).where(Jurisdiction.name == cfg["name"]))
    jurisdiction = result.scalar_one_or_none()
    created = False
    if jurisdiction is None:
        jurisdiction = Jurisdiction(
            id=cfg["id"],
            name=cfg["name"],
            geo_boundary=geo_boundary,
            adapter_type=cfg["adapter_type"],
            adapter_config=cfg["adapter_config"],
        )
        db.add(jurisdiction)
        await db.flush()
        created = True
    else:
        jurisdiction.adapter_type = cfg["adapter_type"]
        jurisdiction.adapter_config = cfg["adapter_config"]
        jurisdiction.geo_boundary = geo_boundary

    # Six departments — one per category. Idempotent by (jurisdiction, name).
    dept_specs = [
        ("Transportation", ["pothole"]),
        ("Transportation — Sidewalks", ["sidewalk damage"]),
        ("Utilities", ["streetlight"]),
        ("Sanitation", ["trash"]),
        ("Public Works", ["graffiti"]),
        ("General", ["other"]),
    ]
    existing = (
        await db.execute(select(Department).where(Department.jurisdiction_id == jurisdiction.id))
    ).scalars().all()
    by_name = {d.name: d for d in existing}
    departments: list[Department] = []
    added = 0
    for name, cats in dept_specs:
        dept = by_name.get(name)
        if dept is None:
            dept = Department(jurisdiction_id=jurisdiction.id, name=name, handles_categories=cats)
            db.add(dept)
            added += 1
        else:
            dept.handles_categories = cats
        departments.append(dept)
    await db.flush()
    return jurisdiction, departments, created, added


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

# (category, status, days_ago_created, blurb, lat, lng)
_REPORT_SPECS: list[tuple[str, str, int, str, float, float]] = [
    ("pothole", "Resolved", 28, "Deep pothole in the eastbound lane, ~30cm wide, near the Charles St crosswalk", 39.2904, -76.6122),
    ("streetlight", "InProgress", 21, "Streetlight out at the corner of Pratt and Light — block is dark at night", 39.2860, -76.6130),
    ("trash", "Acknowledged", 14, "Overflowing public trash can, bags piling up beside the bus stop", 39.2895, -76.6098),
    ("graffiti", "Submitted", 10, "Spray-painted tag on the brick wall facing the parking garage", 39.2922, -76.6189),
    ("sidewalk damage", "Confirmed", 7, "Cracked and heaved sidewalk slab — trip hazard by the crosswalk ramp", 39.2950, -76.6145),
    ("other", "Draft", 2, "Loose metal sign rattling in the wind, mount looks about to fail", 39.2875, -76.6055),
    ("pothole", "InProgress", 18, "Second pothole forming next to a patched one on Lombard St", 39.2882, -76.6108),
    ("trash", "Resolved", 26, "Illegal dumping — mattress and boxes behind the row houses", 39.2990, -76.6160),
]


async def seed_reports(
    db: AsyncSession,
    reporter: User,
    jurisdiction: Jurisdiction,
    departments: list[Department],
) -> list[Report]:
    rng = random.Random(20261008)
    now = datetime.now(UTC)
    dept_by_category: dict[str, Department] = {}
    for d in departments:
        for cat in d.handles_categories:
            dept_by_category[cat] = d

    reports: list[Report] = []
    for category, status, days_ago, blurb, lat, lng in _REPORT_SPECS:
        created = now - timedelta(days=days_ago, hours=rng.randrange(0, 20))
        severity = rng.choice(["low", "medium", "high"])
        # Draft = not yet routed; every submitted-or-later report is routed
        # to Baltimore + its handling department.
        routed = status != "Draft"
        report = Report(
            id=str(uuid.uuid4()),
            category=category,
            description=blurb + DEMO_SUFFIX,
            lat=lat,
            lng=lng,
            location_accuracy=round(rng.uniform(3.0, 15.0), 1),
            severity=severity,
            status=status,
            reporter_id=reporter.id,
            jurisdiction_id=jurisdiction.id if routed else None,
            department_id=dept_by_category[category].id if routed else None,
            created_at=created,
            updated_at=created,
            geom=_point_wkt(lng, lat),
        )
        db.add(report)
        await db.flush()

        # AI prediction — realistic confidence for the assigned category.
        confidence = round(rng.uniform(0.60, 0.97), 3)
        raw_scores = {c: round(rng.uniform(0.01, 0.20), 3) for c in CATEGORIES}
        raw_scores[category] = confidence
        db.add(
            AiPrediction(
                id=str(uuid.uuid4()),
                report_id=report.id,
                model_version=MOBILENET_VERSION,
                category=category,
                confidence=confidence,
                severity_estimate=severity,
                raw_scores=raw_scores,
                created_at=created,
            )
        )
        db.add(
            UserConfirmation(
                id=str(uuid.uuid4()),
                report_id=report.id,
                confirmed_category=category,
                corrected=False,
                created_at=created + timedelta(minutes=1),
            )
        )

        # Status history — walk the ladder up to the current status.
        final_idx = STATUS_LADDER.index(status)
        step_hours = max((days_ago * 24 - 2) // max(final_idx, 1), 1)
        last_ts = created
        for i in range(final_idx + 1):
            ts = created + timedelta(hours=step_hours * i)
            source = "user" if i <= 1 else "jurisdiction"
            db.add(
                ReportStatusHistory(
                    report_id=report.id, status=STATUS_LADDER[i], source=source, created_at=ts
                )
            )
            last_ts = ts
        # ``updated_at`` tracks the last status change, not creation.
        report.updated_at = max(last_ts, created)
        reports.append(report)
    await db.flush()
    return reports


# ---------------------------------------------------------------------------
# Community verifications
# ---------------------------------------------------------------------------


async def seed_verifications(
    db: AsyncSession, reports: list[Report], neighbors: list[User]
) -> int:
    rng = random.Random(31337)
    count = 0
    for report in reports:
        if report.status not in ("InProgress", "Resolved"):
            continue
        responses = (
            ["appears_fixed", "appears_fixed", "not_sure"]
            if report.status == "Resolved"
            else ["still_present", "still_present", "appears_fixed"]
        )
        for neighbor, response in zip(neighbors, responses, strict=True):
            db.add(
                CommunityVerification(
                    report_id=report.id,
                    user_id=neighbor.id,
                    response=response,
                    created_at=report.updated_at + timedelta(hours=rng.randrange(2, 48)),
                )
            )
            count += 1
    await db.flush()
    return count


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


async def main() -> None:
    async with async_session() as db:
        wiped_users = await wipe_demo_data(db)

        # Do NOT seed fake users, fake reports, or fake verifications.
        # Civic Sense operates strictly on real user reports.
        jurisdiction, departments, j_created, d_added = await upsert_baltimore(db)

        await db.commit()

    print("Demo seed complete.")
    print(f"  wiped legacy demo users from prior run : {wiped_users}")
    print(f"  jurisdiction                           : Baltimore ({'created' if j_created else 'updated'})")
    print(f"  departments added                      : {d_added} (of 6 total ensured)")
    print("  reports created                        : 0 (pure mode - no fake data)")


if __name__ == "__main__":
    asyncio.run(main())
