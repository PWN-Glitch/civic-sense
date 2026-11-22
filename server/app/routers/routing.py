"""POST /routing/resolve — given lat/lng + category, return routing decision."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.models import User
from app.schemas import RoutingResolveRequest, RoutingResolveResponse
from app.security import require_user
from app.services.routing_engine import resolve

router = APIRouter(prefix="/routing", tags=["routing"])


@router.post("/resolve", response_model=RoutingResolveResponse)
def resolve_endpoint(
    body: RoutingResolveRequest,
    user: User = Depends(require_user),
) -> RoutingResolveResponse:
    adapter = resolve(body.lat, body.lng)
    result = adapter.route({"category": body.category, "lat": body.lat, "lng": body.lng})
    return RoutingResolveResponse(
        jurisdiction=adapter.name,
        department=result.department,
        method=result.method,
        url=result.url,
        disclaimer=result.disclaimer,
    )
