"""GET /stats/impact — city-wide tallies for the impact screen.

Every number here is counted from rows this app actually wrote: nothing is
projected, sampled or invented. The screen that consumes it says so in words,
because a civic tool that inflates its own impact is worse than one with no
stats at all.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Report, ReportStatusHistory
from app.schemas import CategoryTally, ImpactOut

router = APIRouter(prefix="/stats", tags=["stats"])

# Statuses that count as "resolved" for the headline rate.
_RESOLVED = "Resolved"


@router.get("/impact", response_model=ImpactOut)
async def impact(db: AsyncSession = Depends(get_db)) -> ImpactOut:
    total = int(await db.scalar(select(func.count()).select_from(Report)) or 0)

    status_rows = (
        await db.execute(select(Report.status, func.count()).group_by(Report.status))
    ).all()
    by_status = {str(status): int(count) for status, count in status_rows}
    resolved = by_status.get(_RESOLVED, 0)

    category_rows = (
        await db.execute(select(Report.category, func.count()).group_by(Report.category))
    ).all()
    resolved_by_category = dict(
        (
            await db.execute(
                select(Report.category, func.count())
                .where(Report.status == _RESOLVED)
                .group_by(Report.category)
            )
        ).all()
    )
    by_category = sorted(
        (
            CategoryTally(
                category=str(category),
                total=int(count),
                resolved=int(resolved_by_category.get(category, 0)),
            )
            for category, count in category_rows
        ),
        key=lambda row: (-row.total, row.category),
    )

    # Days from filing to the first "Resolved" history entry.
    first_resolved = (
        select(
            ReportStatusHistory.report_id.label("report_id"),
            func.min(ReportStatusHistory.created_at).label("resolved_at"),
        )
        .where(ReportStatusHistory.status == _RESOLVED)
        .group_by(ReportStatusHistory.report_id)
        .subquery()
    )
    avg_days = await db.scalar(
        select(
            func.avg(
                func.extract(
                    "epoch", first_resolved.c.resolved_at - Report.created_at
                )
                / 86400.0
            )
        ).join(first_resolved, first_resolved.c.report_id == Report.id)
    )

    since = datetime.now(UTC) - timedelta(days=30)
    last_30 = int(
        await db.scalar(
            select(func.count()).select_from(Report).where(Report.created_at >= since)
        )
        or 0
    )

    return ImpactOut(
        total_reports=total,
        resolved_reports=resolved,
        resolution_rate=(resolved / total) if total else 0.0,
        avg_days_to_resolve=round(float(avg_days), 1) if avg_days is not None else None,
        reports_last_30_days=last_30,
        by_status=by_status,
        by_category=by_category,
    )
