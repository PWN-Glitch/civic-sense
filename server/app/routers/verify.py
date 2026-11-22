"""Community verification — one vote per user per report; never auto-resolves.

Community votes are advisory. When appears_fixed >= 3 and strictly
exceeds still_present, responses expose ``community_suggests_resolved`` so the
UI can hint — the official status is only ever changed by the reporter /
jurisdiction lifecycle, never by vote counts.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.middleware.ratelimit import rate_limit_authed
from app.models import CommunityVerification, Report, User
from app.schemas import (
    VerificationCounts,
    VerificationsOut,
    VerifyRequest,
    VerifyResponse,
)
from app.security import require_user

router = APIRouter(prefix="/reports", tags=["verify"])

SUGGEST_RESOLVED_THRESHOLD = 3


async def _get_report_or_404(db: AsyncSession, report_id: str) -> Report:
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="report not found")
    return report


async def _counts(db: AsyncSession, report_id: str) -> VerificationCounts:
    result = await db.execute(
        select(CommunityVerification.response, func.count())
        .where(CommunityVerification.report_id == report_id)
        .group_by(CommunityVerification.response)
    )
    tally = dict(result.all())
    return VerificationCounts(
        still_present=tally.get("still_present", 0),
        appears_fixed=tally.get("appears_fixed", 0),
        not_sure=tally.get("not_sure", 0),
    )


def _suggests_resolved(counts: VerificationCounts) -> bool:
    return (
        counts.appears_fixed >= SUGGEST_RESOLVED_THRESHOLD
        and counts.appears_fixed > counts.still_present
    )


@router.post(
    "/{report_id}/verify",
    response_model=VerifyResponse,
    dependencies=[Depends(rate_limit_authed(route_key="reports.verify", limit=10, window_s=60.0))],
)
async def post_verify(
    report_id: str,
    body: VerifyRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> VerifyResponse:
    report = await _get_report_or_404(db, report_id)

    stmt = (
        pg_insert(CommunityVerification)
        .values(report_id=report.id, user_id=user.id, response=body.response)
        .on_conflict_do_update(
            index_elements=["user_id", "report_id"],
            set_={"response": body.response},
        )
        .returning(CommunityVerification.id)
    )
    result = await db.execute(stmt)
    verification_id = int(result.scalar_one())
    await db.commit()

    return VerifyResponse(verification_id=verification_id, counts=await _counts(db, report.id))


@router.get("/{report_id}/verifications", response_model=VerificationsOut)
async def get_verifications(
    report_id: str,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> VerificationsOut:
    report = await _get_report_or_404(db, report_id)
    counts = await _counts(db, report.id)

    result = await db.execute(
        select(CommunityVerification.response).where(
            CommunityVerification.report_id == report.id,
            CommunityVerification.user_id == user.id,
        )
    )
    user_vote = result.scalar_one_or_none()

    return VerificationsOut(
        counts=counts,
        user_vote=user_vote,
        community_suggests_resolved=_suggests_resolved(counts),
    )
