"""Seed the verified-contacts registry from app/data/contacts.json.

Run from ``server/``:

    python -m scripts.seed_contacts

Idempotent upsert keyed on (jurisdiction_id, channel_type, value): running it
twice updates the same rows instead of duplicating them. Jurisdiction rows are
ensured first because contacts.jurisdiction_id FKs to jurisdictions.id.

Every registry row carries source_url + retrieved_at + verification_status so
the resolver's provenance fields are always populated. We NEVER seed an
invented email/phone — if a destination isn't verified, it isn't in the file.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from importlib import resources

from sqlalchemy import select

from app.db import async_session
from app.models import Contact, Jurisdiction

# jurisdiction_id → (name, adapter_type) for the FK targets we seed against.
_JURISDICTIONS = {
    "baltimore": ("Baltimore", "baltimore_deeplink"),
    "chicago": ("Chicago", "open311"),
    "bloomington": ("Bloomington", "open311"),
}


def _load() -> list[dict]:
    with resources.files("app.data").joinpath("contacts.json").open("r") as f:
        return json.load(f)


async def _ensure_jurisdictions(session) -> None:
    for jid, (name, adapter_type) in _JURISDICTIONS.items():
        existing = await session.get(Jurisdiction, jid)
        if existing is None:
            session.add(Jurisdiction(id=jid, name=name, adapter_type=adapter_type))
    await session.flush()


async def seed() -> tuple[int, int]:
    """Upsert all registry rows. Returns (created, updated) counts."""
    rows = _load()
    now = datetime.now(UTC)
    created = updated = 0
    async with async_session() as session:
        await _ensure_jurisdictions(session)
        for row in rows:
            stmt = select(Contact).where(
                Contact.jurisdiction_id == row.get("jurisdiction_id"),
                Contact.channel_type == row["channel_type"],
                Contact.value == row["value"],
            )
            existing = (await session.execute(stmt)).scalar_one_or_none()
            payload = dict(
                organization=row["organization"],
                department=row.get("department"),
                jurisdiction_id=row.get("jurisdiction_id"),
                channel_type=row["channel_type"],
                value=row["value"],
                purpose=row.get("purpose"),
                source_url=row.get("source_url"),
                source_type=row.get("source_type"),
                verification_status=row.get("verification_status", "unknown"),
                retrieved_at=now,
                last_verified_at=now,
                handles_categories=row.get("handles_categories", []),
                requires=row.get("requires", {}),
                notes=row.get("notes"),
            )
            if existing is None:
                session.add(Contact(**payload))
                created += 1
            else:
                for k, v in payload.items():
                    setattr(existing, k, v)
                updated += 1
        await session.commit()
    return created, updated


def main() -> None:
    created, updated = asyncio.run(seed())
    print(f"contacts seeded: {created} created, {updated} updated")


if __name__ == "__main__":
    main()
