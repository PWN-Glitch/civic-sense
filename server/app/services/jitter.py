"""Coordinate privacy — the one jitter function every read path shares.

A resident's report pin sits at their doorstep. The public map already moves it,
but an exact coordinate anywhere else would quietly undo that, so both the map
and the single-report read use this same deterministic offset: the same report
always lands in the same place, and two views of it never disagree.
"""

from __future__ import annotations

import hashlib

# ~50m in decimal degrees. At mid-latitudes 1° latitude ≈ 111 km, so 50m ≈ 0.00045°.
JITTER_MAX_DEG = 0.00045


def jitter(report_id: str, lat: float, lng: float) -> tuple[float, float]:
    """Deterministic per-report offset of up to ~50m, so markers don't jump."""
    digest = hashlib.sha256(report_id.encode("utf-8")).digest()
    # Two independent offsets in [-1, 1]
    lat_offset = (int.from_bytes(digest[0:8], "big") / 2**64) * 2 - 1
    lng_offset = (int.from_bytes(digest[8:16], "big") / 2**64) * 2 - 1
    return (
        lat + lat_offset * JITTER_MAX_DEG,
        lng + lng_offset * JITTER_MAX_DEG,
    )
