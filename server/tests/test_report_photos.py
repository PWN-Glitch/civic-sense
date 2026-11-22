"""B-W2-5: before/progress/after photo documentation on reports."""

from __future__ import annotations

import io
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from PIL import Image

from app.config import settings


def _jpeg(color=(90, 120, 160)) -> bytes:
    img = Image.new("RGB", (48, 48), color=color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


async def _auth(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, sub: str) -> dict:
    monkeypatch.setattr(settings, "dev_auth_bypass", True)
    monkeypatch.setattr(settings, "google_client_id", "any")
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value={"sub": sub, "aud": "any"})):
        r = await client.post("/auth/google", json={"id_token": "tok"})
    return {"Authorization": f"Bearer {r.json()['jwt']}"}


async def _report(client: AsyncClient, headers: dict) -> str:
    r = await client.post(
        "/reports",
        json={"category": "graffiti", "description": "tag on wall", "lat": 39.29, "lng": -76.61},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["report"]["id"]


async def _upload(client: AsyncClient, headers: dict, color=(90, 120, 160)) -> str:
    files = {"file": ("p.jpg", _jpeg(color), "image/jpeg")}
    r = await client.post("/media", files=files, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["photo_id"]


@pytest.mark.asyncio
async def test_attach_first_photo_defaults_before(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    h = await _auth(client, monkeypatch, "u1")
    rid = await _report(client, h)
    pid = await _upload(client, h)

    r = await client.post(f"/reports/{rid}/photos?photo_id={pid}", headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["kind"] == "before"
    assert r.json()["photo_id"] == pid


@pytest.mark.asyncio
async def test_attach_explicit_kinds(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    h = await _auth(client, monkeypatch, "u1")
    rid = await _report(client, h)
    p_before = await _upload(client, h, (200, 50, 50))
    p_after = await _upload(client, h, (50, 200, 50))

    r1 = await client.post(f"/reports/{rid}/photos?photo_id={p_before}&kind=before", headers=h)
    assert r1.status_code == 201
    assert r1.json()["kind"] == "before"

    r2 = await client.post(f"/reports/{rid}/photos?photo_id={p_after}&kind=after", headers=h)
    assert r2.status_code == 201
    assert r2.json()["kind"] == "after"


@pytest.mark.asyncio
async def test_attach_second_photo_defaults_progress(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    h = await _auth(client, monkeypatch, "u1")
    rid = await _report(client, h)
    p1 = await _upload(client, h)
    p2 = await _upload(client, h, (10, 10, 200))

    await client.post(f"/reports/{rid}/photos?photo_id={p1}", headers=h)
    r = await client.post(f"/reports/{rid}/photos?photo_id={p2}", headers=h)
    assert r.json()["kind"] == "progress"


@pytest.mark.asyncio
async def test_get_report_returns_photos_tagged(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    h = await _auth(client, monkeypatch, "u1")
    rid = await _report(client, h)
    p_before = await _upload(client, h, (200, 50, 50))
    p_after = await _upload(client, h, (50, 200, 50))
    await client.post(f"/reports/{rid}/photos?photo_id={p_before}&kind=before", headers=h)
    await client.post(f"/reports/{rid}/photos?photo_id={p_after}&kind=after", headers=h)

    r = await client.get(f"/reports/{rid}", headers=h)
    assert r.status_code == 200, r.text
    photos = r.json()["photos"]
    assert len(photos) == 2
    by_kind = {p["kind"]: p for p in photos}
    assert set(by_kind) == {"before", "after"}
    for p in photos:
        assert p["photo_id"]
        assert p["url"].startswith("/media/")
        assert isinstance(p["blurred"], bool)


@pytest.mark.asyncio
async def test_get_report_includes_verification_counts(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    reporter = await _auth(client, monkeypatch, "reporter")
    voter = await _auth(client, monkeypatch, "voter")
    rid = await _report(client, reporter)
    await client.post(f"/reports/{rid}/verify", json={"response": "appears_fixed"}, headers=voter)

    r = await client.get(f"/reports/{rid}", headers=reporter)
    assert r.status_code == 200
    assert r.json()["verifications"] == {"still_present": 0, "appears_fixed": 1, "not_sure": 0}


@pytest.mark.asyncio
async def test_attach_invalid_kind_422(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    h = await _auth(client, monkeypatch, "u1")
    rid = await _report(client, h)
    pid = await _upload(client, h)
    r = await client.post(f"/reports/{rid}/photos?photo_id={pid}&kind=bogus", headers=h)
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_attach_unknown_photo_404(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    h = await _auth(client, monkeypatch, "u1")
    rid = await _report(client, h)
    r = await client.post(f"/reports/{rid}/photos?photo_id=nope", headers=h)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_attach_photo_conflict_other_report(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    h = await _auth(client, monkeypatch, "u1")
    rid1 = await _report(client, h)
    rid2 = await _report(client, h)
    pid = await _upload(client, h)
    await client.post(f"/reports/{rid1}/photos?photo_id={pid}", headers=h)
    r = await client.post(f"/reports/{rid2}/photos?photo_id={pid}", headers=h)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_report_out_empty_photos_and_zero_counts(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h = await _auth(client, monkeypatch, "u1")
    rid = await _report(client, h)
    r = await client.get(f"/reports/{rid}", headers=h)
    assert r.status_code == 200
    assert r.json()["photos"] == []
    assert r.json()["verifications"] == {"still_present": 0, "appears_fixed": 0, "not_sure": 0}


@pytest.mark.asyncio
async def test_attach_someone_elses_photo_forbidden(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    owner = await _auth(client, monkeypatch, "u-photo-owner")
    thief = await _auth(client, monkeypatch, "u-photo-thief")
    pid = await _upload(client, owner)
    thief_report = await _report(client, thief)

    r = await client.post(f"/reports/{thief_report}/photos?photo_id={pid}", headers=thief)
    assert r.status_code == 403
    # The photo stays unattached, so its uploader can still use it.
    own_report = await _report(client, owner)
    assert (await client.post(f"/reports/{own_report}/photos?photo_id={pid}", headers=owner)).status_code == 201


@pytest.mark.asyncio
async def test_neighbor_adds_own_photo_as_evidence(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir) -> None:
    """Duplicate sheet "Add photo": a resident's own upload onto someone else's report."""
    reporter = await _auth(client, monkeypatch, "u-evidence-reporter")
    neighbor = await _auth(client, monkeypatch, "u-evidence-neighbor")
    rid = await _report(client, reporter)
    pid = await _upload(client, neighbor)

    r = await client.post(f"/reports/{rid}/photos?photo_id={pid}&kind=before", headers=neighbor)
    assert r.status_code == 201, r.text
    photos = (await client.get(f"/reports/{rid}", headers=reporter)).json()["photos"]
    assert [p["photo_id"] for p in photos] == [pid]


@pytest.mark.asyncio
async def test_legacy_photo_without_uploader_cannot_be_attached(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, db_session, tmp_upload_dir
) -> None:
    from app.models import Photo

    h = await _auth(client, monkeypatch, "u-legacy")
    rid = await _report(client, h)
    legacy_id = "00000000-0000-0000-0000-000000000006"
    db_session.add(Photo(id=legacy_id, storage_key=f"{legacy_id}.jpg", uploader_id=None))
    await db_session.commit()

    r = await client.post(f"/reports/{rid}/photos?photo_id={legacy_id}", headers=h)
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_reattach_same_kind_is_idempotent_but_relabel_is_refused(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_upload_dir
) -> None:
    h = await _auth(client, monkeypatch, "u-relabel")
    rid = await _report(client, h)
    pid = await _upload(client, h)
    assert (await client.post(f"/reports/{rid}/photos?photo_id={pid}&kind=before", headers=h)).status_code == 201

    # A retry whose first response was lost gets the same answer.
    again = await client.post(f"/reports/{rid}/photos?photo_id={pid}&kind=before", headers=h)
    assert again.status_code == 201
    assert again.json()["kind"] == "before"
    # Omitting kind on a retry keeps the original label instead of defaulting to "progress".
    bare = await client.post(f"/reports/{rid}/photos?photo_id={pid}", headers=h)
    assert bare.json()["kind"] == "before"

    # Evidence can't be turned into a claim that the issue is fixed.
    relabel = await client.post(f"/reports/{rid}/photos?photo_id={pid}&kind=after", headers=h)
    assert relabel.status_code == 409
    photos = (await client.get(f"/reports/{rid}", headers=h)).json()["photos"]
    assert [(p["photo_id"], p["kind"]) for p in photos] == [(pid, "before")]
