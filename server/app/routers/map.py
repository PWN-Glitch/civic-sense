"""GET /map/issues — geographic query with privacy jitter."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Report, User
from app.schemas import MapIssue
from app.security import require_user
from app.services.jitter import jitter as _jitter

router = APIRouter(prefix="/map", tags=["map"])

_LIMIT = 500


def _parse_bbox(bbox: str) -> tuple[float, float, float, float]:
    """Parse 'minLng,minLat,maxLng,maxLat' → 4-tuple of floats; 422 on bad input."""
    parts = bbox.split(",")
    if len(parts) != 4:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="bbox must be 'minLng,minLat,maxLng,maxLat'",
        )
    try:
        min_lng, min_lat, max_lng, max_lat = (float(p) for p in parts)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="bbox components must be numbers",
        ) from None
    if not (-180 <= min_lng <= 180 and -180 <= max_lng <= 180):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="lng out of range")
    if not (-90 <= min_lat <= 90 and -90 <= max_lat <= 90):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="lat out of range")
    if min_lng >= max_lng or min_lat >= max_lat:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="bbox min must be less than max",
        )
    return min_lng, min_lat, max_lng, max_lat


@router.get("/issues", response_model=list[MapIssue])
async def list_issues(
    bbox: str = Query(..., description="minLng,minLat,maxLng,maxLat"),
    category: str | None = Query(None),
    status: str | None = Query(None),
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> list[MapIssue]:
    min_lng, min_lat, max_lng, max_lat = _parse_bbox(bbox)

    envelope = func.ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    stmt = select(Report).where(func.ST_Within(Report.geom, envelope))
    if category:
        stmt = stmt.where(Report.category == category)
    if status:
        stmt = stmt.where(Report.status == status)
    stmt = stmt.limit(_LIMIT)

    result = await db.execute(stmt)
    rows = list(result.scalars().all())

    return [
        MapIssue(
            id=r.id,
            category=r.category,
            status=r.status,
            lat=jlat,
            lng=jlng,
        )
        for r in rows
        for jlat, jlng in [_jitter(r.id, float(r.lat), float(r.lng))]
    ]
