"""B1/B4: report ORM round-trip + reports HTTP lifecycle."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings


async def _signup(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, sub: str) -> dict:
    """Sign in via dev bypass as a fresh user keyed on `sub`."""
    monkeypatch.setattr(settings, "dev_auth_bypass", True)
    from unittest.mock import AsyncMock, patch

    payload = {"sub": sub, "aud": "any", "name": f"User {sub}"}
    # Patch google verify so different subs map to different users.
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value=payload)):
        monkeypatch.setattr(settings, "google_client_id", "any")
        r = await client.post("/auth/google", json={"id_token": "tok"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['jwt']}"}


@pytest.mark.asyncio
async def test_report_persists(db_session: AsyncSession) -> None:
    from app import models

    user = models.User(google_sub="g-sub-1", display_name="Tester")
    db_session.add(user)
    await db_session.flush()

    report = models.Report(
        category="pothole",
        description="Big pothole on Main St",
        lat=39.2904,
        lng=-76.6122,
        location_accuracy=5.0,
        severity="moderate",
        status="Draft",
        reporter_id=user.id,
        geom="SRID=4326;POINT(-76.6122 39.2904)",
    )
    db_session.add(report)
    await db_session.commit()

    result = await db_session.execute(select(models.Report).where(models.Report.id == report.id))
    got = result.scalar_one()
    assert got.category == "pothole"
    assert got.status == "Draft"
    assert float(got.lat) == pytest.approx(39.2904)
    assert float(got.lng) == pytest.approx(-76.6122)
    assert got.reporter_id == user.id
    assert got.geom is not None


# ---------- B4 HTTP tests ----------


@pytest.mark.asyncio
async def test_create_report_persists_and_returns_id(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    headers = await _signup(client, monkeypatch, "u-create")
    body = {
        "category": "pothole",
        "description": "Big pothole on Main St",
        "lat": 39.2904,
        "lng": -76.6122,
        "location_accuracy": 5.0,
        "severity": "moderate",
    }
    r = await client.post("/reports", json=body, headers=headers)
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["report"]["id"]
    assert data["report"]["category"] == "pothole"
    assert data["report"]["status"] == "Draft"
    assert "possible_duplicates" in data


@pytest.mark.asyncio
async def test_create_report_invalid_lat_422(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    headers = await _signup(client, monkeypatch, "u-badlat")
    body = {
        "category": "pothole",
        "description": "x",
        "lat": 91.0,
        "lng": -76.6,
    }
    r = await client.post("/reports", json=body, headers=headers)
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_report_invalid_category_422(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    headers = await _signup(client, monkeypatch, "u-badcat")
    body = {
        "category": "not-a-category",
        "description": "x",
        "lat": 39.0,
        "lng": -76.6,
    }
    r = await client.post("/reports", json=body, headers=headers)
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_reports_mine_returns_only_own(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h1 = await _signup(client, monkeypatch, "u-own-1")
    h2 = await _signup(client, monkeypatch, "u-own-2")
    body = {"category": "trash", "description": "t", "lat": 39.0, "lng": -76.6}
    r1 = await client.post("/reports", json=body, headers=h1)
    r2 = await client.post("/reports", json=body, headers=h2)
    assert r1.status_code == 201 and r2.status_code == 201

    mine = await client.get("/reports/mine", headers=h1)
    assert mine.status_code == 200
    ids = [x["id"] for x in mine.json()]
    assert r1.json()["report"]["id"] in ids
    assert r2.json()["report"]["id"] not in ids


@pytest.mark.asyncio
async def test_patch_report_owner_only(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h1 = await _signup(client, monkeypatch, "u-owner")
    h2 = await _signup(client, monkeypatch, "u-other")
    body = {"category": "graffiti", "description": "tag", "lat": 39.29, "lng": -76.61}
    r = await client.post("/reports", json=body, headers=h1)
    report_id = r.json()["report"]["id"]

    # Non-owner cannot patch
    r2 = await client.patch(f"/reports/{report_id}", json={"description": "hacked"}, headers=h2)
    assert r2.status_code == 403

    # Owner can patch description
    r3 = await client.patch(f"/reports/{report_id}", json={"description": "updated"}, headers=h1)
    assert r3.status_code == 200
    assert r3.json()["description"] == "updated"


@pytest.mark.asyncio
async def test_patch_report_status_transitions(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h = await _signup(client, monkeypatch, "u-lc")
    body = {"category": "streetlight", "description": "out", "lat": 39.29, "lng": -76.61}
    r = await client.post("/reports", json=body, headers=h)
    rid = r.json()["report"]["id"]

    # Draft → Confirmed ok
    r1 = await client.patch(f"/reports/{rid}", json={"status": "Confirmed"}, headers=h)
    assert r1.status_code == 200
    assert r1.json()["status"] == "Confirmed"

    # Confirmed → InProgress is NOT allowed (must go through Submitted, Acknowledged)
    r2 = await client.patch(f"/reports/{rid}", json={"status": "InProgress"}, headers=h)
    assert r2.status_code == 422

    # Confirmed → Submitted ok
    r3 = await client.patch(f"/reports/{rid}", json={"status": "Submitted"}, headers=h)
    assert r3.status_code == 200


@pytest.mark.asyncio
async def test_patch_appends_status_history(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, db_session: AsyncSession) -> None:
    h = await _signup(client, monkeypatch, "u-hist")
    body = {"category": "pothole", "description": "p", "lat": 39.29, "lng": -76.61}
    r = await client.post("/reports", json=body, headers=h)
    rid = r.json()["report"]["id"]
    await client.patch(f"/reports/{rid}", json={"status": "Confirmed"}, headers=h)

    from app import models
    result = await db_session.execute(
        select(models.ReportStatusHistory).where(models.ReportStatusHistory.report_id == rid).order_by(models.ReportStatusHistory.created_at)
    )
    rows = list(result.scalars().all())
    statuses = [row.status for row in rows]
    assert statuses == ["Draft", "Confirmed"]


@pytest.mark.asyncio
async def test_duplicate_detection_flags_nearby_same_category(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h = await _signup(client, monkeypatch, "u-dup")
    base = {"category": "pothole", "description": "first", "lat": 39.2904, "lng": -76.6122}
    r1 = await client.post("/reports", json=base, headers=h)
    assert r1.status_code == 201
    assert r1.json()["possible_duplicates"] == []

    # Same spot, same category → flagged
    near = {"category": "pothole", "description": "second", "lat": 39.29041, "lng": -76.61221}
    r2 = await client.post("/reports", json=near, headers=h)
    assert r2.status_code == 201
    dups = r2.json()["possible_duplicates"]
    assert len(dups) >= 1
    assert dups[0]["id"] == r1.json()["report"]["id"]

    # Same spot, different category → not flagged
    diff = {"category": "trash", "description": "third", "lat": 39.29041, "lng": -76.61221}
    r3 = await client.post("/reports", json=diff, headers=h)
    assert r3.status_code == 201
    assert r3.json()["possible_duplicates"] == []


@pytest.mark.asyncio
async def test_get_report_by_id(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h = await _signup(client, monkeypatch, "u-get")
    body = {"category": "trash", "description": "get me", "lat": 39.0, "lng": -76.0}
    r = await client.post("/reports", json=body, headers=h)
    rid = r.json()["report"]["id"]
    r2 = await client.get(f"/reports/{rid}", headers=h)
    assert r2.status_code == 200
    assert r2.json()["id"] == rid
    assert r2.json()["description"] == "get me"


@pytest.mark.asyncio
async def test_get_report_404(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h = await _signup(client, monkeypatch, "u-404")
    r = await client.get("/reports/does-not-exist", headers=h)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_preflight_duplicate_check_does_not_create(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """GET /reports/duplicates finds neighbours without filing anything."""
    h = await _signup(client, monkeypatch, "u-predup")
    params = {"category": "pothole", "lat": 39.2904, "lng": -76.6122}

    # Nothing filed yet → empty, and no report was created by the probe.
    r0 = await client.get("/reports/duplicates", params=params, headers=h)
    assert r0.status_code == 200
    assert r0.json() == []
    mine = await client.get("/reports/mine", headers=h)
    assert mine.json() == []

    created = await client.post(
        "/reports", json={**params, "description": "first"}, headers=h
    )
    assert created.status_code == 201
    report_id = created.json()["report"]["id"]

    near = {"category": "pothole", "lat": 39.29041, "lng": -76.61221}
    r1 = await client.get("/reports/duplicates", params=near, headers=h)
    assert r1.status_code == 200
    assert [d["id"] for d in r1.json()] == [report_id]

    # exclude_id lets a caller ignore the report it is editing.
    r2 = await client.get(
        "/reports/duplicates", params={**near, "exclude_id": report_id}, headers=h
    )
    assert r2.json() == []

    # Different category at the same spot is not a duplicate.
    r3 = await client.get(
        "/reports/duplicates", params={**near, "category": "trash"}, headers=h
    )
    assert r3.json() == []

    # The probe must not have filed anything.
    mine = await client.get("/reports/mine", headers=h)
    assert len(mine.json()) == 1


@pytest.mark.asyncio
async def test_preflight_duplicate_check_requires_auth(client: AsyncClient) -> None:
    r = await client.get(
        "/reports/duplicates",
        params={"category": "pothole", "lat": 39.2904, "lng": -76.6122},
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_report_carries_status_history(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The signature status timeline renders from status_history — it must be sent."""
    h = await _signup(client, monkeypatch, "u-history")
    created = await client.post(
        "/reports",
        json={"category": "pothole", "description": "d", "lat": 39.29, "lng": -76.61},
        headers=h,
    )
    assert created.status_code == 201
    history = created.json()["report"]["status_history"]
    assert [entry["status"] for entry in history] == ["Draft"]
    # Lifecycle status and our own hand-off state travel separately.
    assert created.json()["report"]["submission_state"] == "draft"

    report_id = created.json()["report"]["id"]
    await client.patch(f"/reports/{report_id}", json={"status": "Confirmed"}, headers=h)
    fetched = await client.get(f"/reports/{report_id}", headers=h)
    assert [e["status"] for e in fetched.json()["status_history"]] == ["Draft", "Confirmed"]


@pytest.mark.asyncio
async def test_exact_coordinates_only_for_the_reporter(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The public map jitters the pin; a single-report read must not undo that."""
    owner = await _signup(client, monkeypatch, "u-coords-owner")
    other = await _signup(client, monkeypatch, "u-coords-other")
    lat, lng = 39.2904, -76.6122
    created = await client.post(
        "/reports",
        json={"category": "pothole", "description": "d", "lat": lat, "lng": lng},
        headers=owner,
    )
    assert created.status_code == 201
    report_id = created.json()["report"]["id"]

    mine = await client.get(f"/reports/{report_id}", headers=owner)
    assert mine.status_code == 200
    assert (mine.json()["lat"], mine.json()["lng"]) == (lat, lng)

    theirs = await client.get(f"/reports/{report_id}", headers=other)
    assert theirs.status_code == 200
    body = theirs.json()
    assert (body["lat"], body["lng"]) != (lat, lng)
    # Under ~50m plus rounding slack — enough to hide the doorstep, not the block.
    assert abs(body["lat"] - lat) <= 0.0005
    assert abs(body["lng"] - lng) <= 0.0005
    # Same offset the map already applies, so the two views never disagree.
    mapped = await client.get(
        "/map/issues", params={"bbox": "-76.7,39.2,-76.5,39.4"}, headers=other
    )
    pin = next(i for i in mapped.json() if i["id"] == report_id)
    assert (pin["lat"], pin["lng"]) == (body["lat"], body["lng"])


@pytest.mark.asyncio
async def test_delete_report_owner_success(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = await _signup(client, monkeypatch, "u-delete-owner")
    created = await client.post(
        "/reports",
        json={"category": "pothole", "description": "Delete me", "lat": 39.2904, "lng": -76.6122},
        headers=owner,
    )
    assert created.status_code == 201
    report_id = created.json()["report"]["id"]

    res = await client.delete(f"/reports/{report_id}", headers=owner)
    assert res.status_code == 204

    # Verify report is gone
    get_res = await client.get(f"/reports/{report_id}", headers=owner)
    assert get_res.status_code == 404


@pytest.mark.asyncio
async def test_delete_report_non_owner_forbidden(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = await _signup(client, monkeypatch, "u-del-owner-2")
    stranger = await _signup(client, monkeypatch, "u-del-stranger")
    created = await client.post(
        "/reports",
        json={"category": "pothole", "description": "Stay here", "lat": 39.2904, "lng": -76.6122},
        headers=owner,
    )
    report_id = created.json()["report"]["id"]

    res = await client.delete(f"/reports/{report_id}", headers=stranger)
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_delete_report_not_found(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _signup(client, monkeypatch, "u-del-404")
    res = await client.delete("/reports/non-existent-uuid", headers=user)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_duplicate_results_hide_exact_coordinates_from_others(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Both duplicate paths apply the same jitter as GET /reports/{id}."""
    owner = await _signup(client, monkeypatch, "u-dupcoords-owner")
    other = await _signup(client, monkeypatch, "u-dupcoords-other")
    lat, lng = 39.2904, -76.6122
    created = await client.post(
        "/reports",
        json={"category": "pothole", "description": "d", "lat": lat, "lng": lng},
        headers=owner,
    )
    report_id = created.json()["report"]["id"]
    public = (await client.get(f"/reports/{report_id}", headers=other)).json()
    public_pin = (public["lat"], public["lng"])
    assert public_pin != (lat, lng)

    near = {"category": "pothole", "lat": 39.29041, "lng": -76.61221}
    preflight = await client.get("/reports/duplicates", params=near, headers=other)
    [dup] = [d for d in preflight.json() if d["id"] == report_id]
    assert (dup["lat"], dup["lng"]) == public_pin

    filed = await client.post("/reports", json={**near, "description": "again"}, headers=other)
    [dup] = [d for d in filed.json()["possible_duplicates"] if d["id"] == report_id]
    assert (dup["lat"], dup["lng"]) == public_pin

    # The reporter still sees their own exact pin.
    own = await client.get("/reports/duplicates", params=near, headers=owner)
    [dup] = [d for d in own.json() if d["id"] == report_id]
    assert (dup["lat"], dup["lng"]) == (lat, lng)


@pytest.mark.asyncio
async def test_create_with_same_client_ref_returns_the_first_report(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A retried submit whose first response was lost must not file a second report."""
    h = await _signup(client, monkeypatch, "u-replay")
    body = {"category": "pothole", "description": "d", "lat": 39.2904, "lng": -76.6122, "client_ref": "ref-1"}
    first = await client.post("/reports", json=body, headers=h)
    again = await client.post("/reports", json=body, headers=h)
    assert first.status_code == again.status_code == 201
    assert again.json()["report"]["id"] == first.json()["report"]["id"]
    assert len((await client.get("/reports/mine", headers=h)).json()) == 1

    # The key is per reporter: someone else's identical key files their own report.
    other = await _signup(client, monkeypatch, "u-replay-other")
    theirs = await client.post("/reports", json=body, headers=other)
    assert theirs.json()["report"]["id"] != first.json()["report"]["id"]
