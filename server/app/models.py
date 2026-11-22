"""SQLAlchemy 2 models — Civic Sense data model.

Per spec §Data model: observation ≠ prediction ≠ confirmation ≠ status.
Nine tables. reports.geom is PostGIS geometry(Point,4326) with a GiST index.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _uuid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    reports: Mapped[list[Report]] = relationship(back_populates="reporter", cascade="all, delete-orphan")


class Jurisdiction(Base):
    __tablename__ = "jurisdictions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    geo_boundary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    adapter_type: Mapped[str] = mapped_column(String(64), nullable=False)
    adapter_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    departments: Mapped[list[Department]] = relationship(back_populates="jurisdiction", cascade="all, delete-orphan")


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    jurisdiction_id: Mapped[str] = mapped_column(ForeignKey("jurisdictions.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    handles_categories: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)

    jurisdiction: Mapped[Jurisdiction] = relationship(back_populates="departments")


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    category: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    location_accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    severity: Mapped[str] = mapped_column(String(32), nullable=False, default="low")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="Draft", index=True)
    # Submission state machine (distinct from official lifecycle status):
    # draft | prepared | user_approved | submission_attempted | submitted | status_unknown
    submission_state: Mapped[str] = mapped_column(String(32), nullable=False, default="draft", server_default="draft")
    reporter_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    # Client-chosen key, so replaying a create whose response was lost returns the same report.
    client_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    jurisdiction_id: Mapped[str | None] = mapped_column(ForeignKey("jurisdictions.id"), nullable=True)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    geom = mapped_column(Geometry(geometry_type="POINT", srid=4326), nullable=True)

    __table_args__ = (
        Index("uq_reports_reporter_client_ref", "reporter_id", "client_ref", unique=True),
    )

    reporter: Mapped[User] = relationship(back_populates="reports")
    ai_predictions: Mapped[list[AiPrediction]] = relationship(back_populates="report", cascade="all, delete-orphan")
    user_confirmations: Mapped[list[UserConfirmation]] = relationship(
        back_populates="report", cascade="all, delete-orphan"
    )
    status_history: Mapped[list[ReportStatusHistory]] = relationship(
        back_populates="report", cascade="all, delete-orphan", order_by="ReportStatusHistory.created_at"
    )
    photos: Mapped[list[Photo]] = relationship(back_populates="report", cascade="all, delete-orphan")
    drafts: Mapped[list[ReportDraft]] = relationship(
        back_populates="report", cascade="all, delete-orphan", order_by="ReportDraft.created_at"
    )
    events: Mapped[list[ReportEvent]] = relationship(
        back_populates="report", cascade="all, delete-orphan", order_by="ReportEvent.created_at"
    )


Index("ix_reports_geom_gist", Report.geom, postgresql_using="gist")


class AiPrediction(Base):
    __tablename__ = "ai_predictions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    report_id: Mapped[str] = mapped_column(ForeignKey("reports.id"), nullable=False, index=True)
    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    severity_estimate: Mapped[str] = mapped_column(String(32), nullable=False)
    raw_scores: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    report: Mapped[Report] = relationship(back_populates="ai_predictions")


class UserConfirmation(Base):
    __tablename__ = "user_confirmations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    report_id: Mapped[str] = mapped_column(ForeignKey("reports.id"), nullable=False, index=True)
    confirmed_category: Mapped[str] = mapped_column(String(32), nullable=False)
    corrected: Mapped[bool] = mapped_column(nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    report: Mapped[Report] = relationship(back_populates="user_confirmations")


class ReportStatusHistory(Base):
    __tablename__ = "report_status_history"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    report_id: Mapped[str] = mapped_column(ForeignKey("reports.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    source: Mapped[str] = mapped_column(String(64), nullable=False, default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    report: Mapped[Report] = relationship(back_populates="status_history")


class CommunityVerification(Base):
    __tablename__ = "community_verifications"
    __table_args__ = (
        # One open vote per user per report; re-vote replaces (upsert).
        Index("uq_community_verifications_user_report", "user_id", "report_id", unique=True),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    report_id: Mapped[str] = mapped_column(ForeignKey("reports.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    response: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Contact(Base):
    """Verified official contact for a jurisdiction/department.

    Rows come only from a curated registry or an official source confirmed
    by administration. We never fabricate values.
    """

    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    organization: Mapped[str] = mapped_column(String(255), nullable=False)
    department: Mapped[str | None] = mapped_column(String(255), nullable=True)
    jurisdiction_id: Mapped[str | None] = mapped_column(ForeignKey("jurisdictions.id"), nullable=True, index=True)
    channel_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    value: Mapped[str] = mapped_column(String(1024), nullable=False)
    purpose: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    source_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    verification_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="unknown"
    )  # verified | likely | unverified | unknown
    retrieved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    handles_categories: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    requires: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ReportDraft(Base):
    """Composed report draft for a specific channel. user_edited guards
    against regenerate() overwriting human edits."""

    __tablename__ = "report_drafts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    report_id: Mapped[str] = mapped_column(ForeignKey("reports.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # email|webform|phone|open311|manual
    subject: Mapped[str] = mapped_column(Text, nullable=False, default="")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    recipient: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    user_edited: Mapped[bool] = mapped_column(nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    report: Mapped[Report] = relationship(back_populates="drafts")


class ReportEvent(Base):
    """Audit log for submission transitions and draft updates."""

    __tablename__ = "report_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    report_id: Mapped[str] = mapped_column(ForeignKey("reports.id"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(48), nullable=False)
    detail: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    report: Mapped[Report] = relationship(back_populates="events")


class Photo(Base):
    __tablename__ = "photos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    report_id: Mapped[str | None] = mapped_column(ForeignKey("reports.id"), nullable=True, index=True)
    # NULL for photos uploaded before 0006; nobody can attach those.
    uploader_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    exif_stripped: Mapped[bool] = mapped_column(nullable=False, default=False)
    blurred: Mapped[bool] = mapped_column(nullable=False, default=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="before")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    report: Mapped[Report | None] = relationship(back_populates="photos")


__all__ = [
    "Base",
    "User",
    "Report",
    "AiPrediction",
    "UserConfirmation",
    "ReportStatusHistory",
    "CommunityVerification",
    "Jurisdiction",
    "Department",
    "Photo",
    "Contact",
    "ReportDraft",
    "ReportEvent",
]
