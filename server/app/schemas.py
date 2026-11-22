"""Pydantic request/response schemas (API contract)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

# ---- auth ----


class GoogleAuthRequest(BaseModel):
    id_token: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    display_name: str | None = Field(None, max_length=255)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)


class UserOut(BaseModel):
    id: str
    google_sub: str | None = None
    email: str | None = None
    display_name: str | None = None

    model_config = {"from_attributes": True}


class GoogleAuthResponse(BaseModel):
    jwt: str
    user: UserOut


# ---- classify ----


class Prediction(BaseModel):
    category: str
    confidence: float


class Severity(BaseModel):
    level: Literal["low", "moderate", "high"]
    reason: str


class ClassifyResponse(BaseModel):
    predictions: list[Prediction]
    band: Literal["high", "medium", "low"]
    severity: Severity
    disclaimer: str


# ---- media ----


class MediaResponse(BaseModel):
    photo_id: str
    url: str
    exif_stripped: bool
    blurred: bool
    faces_blurred: int = 0
    plates_blurred: int = 0
    blur_engine: str = "none"


# ---- verification ----


VERIFICATION_RESPONSES = ("still_present", "appears_fixed", "not_sure")


class VerifyRequest(BaseModel):
    response: Literal["still_present", "appears_fixed", "not_sure"]


class VerificationCounts(BaseModel):
    still_present: int = 0
    appears_fixed: int = 0
    not_sure: int = 0


class VerifyResponse(BaseModel):
    verification_id: int
    counts: VerificationCounts


class VerificationsOut(BaseModel):
    counts: VerificationCounts
    user_vote: str | None = None
    community_suggests_resolved: bool = False


# ---- reports ----


REPORT_CATEGORIES = ("pothole", "streetlight", "trash", "graffiti", "sidewalk damage", "other")
REPORT_STATUSES = ("Draft", "Confirmed", "Submitted", "Acknowledged", "InProgress", "Resolved")

PHOTO_KINDS = ("before", "progress", "after")


class PhotoOut(BaseModel):
    photo_id: str
    kind: str
    url: str
    blurred: bool


class ReportPhotoAttachResponse(BaseModel):
    photo_id: str
    kind: str
    url: str
    blurred: bool


class ReportCreate(BaseModel):
    category: str = Field(..., pattern="^(pothole|streetlight|trash|graffiti|sidewalk damage|other)$")
    description: str = ""
    lat: float = Field(..., ge=-90.0, le=90.0)
    lng: float = Field(..., ge=-180.0, le=180.0)
    location_accuracy: float | None = None
    severity: str = "low"
    ai_prediction_id: str | None = None
    client_ref: str | None = Field(None, min_length=1, max_length=64)


class ReportPatch(BaseModel):
    description: str | None = None
    category: str | None = Field(None, pattern="^(pothole|streetlight|trash|graffiti|sidewalk damage|other)$")
    status: str | None = None


class StatusHistoryOut(BaseModel):
    status: str
    source: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ReportOut(BaseModel):
    id: str
    category: str
    description: str
    lat: float
    lng: float
    location_accuracy: float | None
    severity: str
    status: str
    reporter_id: str
    jurisdiction_id: str | None = None
    department_id: int | None = None
    created_at: datetime
    updated_at: datetime
    photos: list[PhotoOut] = []
    verifications: VerificationCounts = VerificationCounts()
    status_history: list[StatusHistoryOut] = []
    # What we observed about our own hand-off; distinct from lifecycle `status`.
    submission_state: str = "draft"

    model_config = {"from_attributes": True}


class ReportCreateResponse(BaseModel):
    report: ReportOut
    possible_duplicates: list[ReportOut] = []


# ---- map ----


class MapIssue(BaseModel):
    id: str
    category: str
    status: str
    lat: float
    lng: float


# ---- routing ----


class RoutingResolveRequest(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lng: float = Field(..., ge=-180.0, le=180.0)
    category: str = Field(..., pattern="^(pothole|streetlight|trash|graffiti|sidewalk damage|other)$")


class RoutingResolveResponse(BaseModel):
    jurisdiction: str
    department: str
    method: Literal["api", "deeplink"]
    url: str | None = None
    disclaimer: str


# ---- contact resolver & report composer (plan 2026-10-08) ----

CHANNEL_TYPES = (
    "OPEN311",
    "API",
    "EMAIL",
    "PHONE",
    "WEB_FORM",
    "GOVERNMENT_PORTAL",
    "MOBILE_APP",
    "IN_PERSON",
    "MANUAL",
)
VERIFICATION_STATUSES = ("verified", "likely", "unverified", "unknown")
DRAFT_KINDS = ("email", "webform", "phone", "open311", "manual")
SUBMISSION_STATES = ("draft", "prepared", "user_approved", "submission_attempted", "submitted", "status_unknown")


class SubmissionChannelOut(BaseModel):
    """Ranked submission option from the verified registry."""

    type: str  # one of CHANNEL_TYPES
    destination: str | None = None
    confidence: float = 0.0
    reasons: list[str] = []
    source_url: str | None = None
    verification_status: str = "unknown"
    requires: dict = {}


class UniversalReportIssue(BaseModel):
    category: str
    subcategory: str | None = None
    description: str = ""
    severity: str = "low"


class UniversalReportLocation(BaseModel):
    lat: float
    lng: float
    address: str | None = None
    jurisdiction: str | None = None


class UniversalReportResponsibility(BaseModel):
    organization: str | None = None
    department: str | None = None
    confidence: float = 0.0
    reasons: list[str] = []


class UniversalReportSubmission(BaseModel):
    method: str | None = None
    destination: str | None = None
    source: str | None = None


class UniversalReportBody(BaseModel):
    subject: str = ""
    body: str = ""


class UniversalReportVerification(BaseModel):
    user_approved: bool = False


class UniversalReport(BaseModel):
    """Canonical intermediate representation of an issue report."""

    issue: UniversalReportIssue
    location: UniversalReportLocation
    evidence: list[str] = []  # photo_ids
    responsibility: UniversalReportResponsibility = UniversalReportResponsibility()
    submission: UniversalReportSubmission = UniversalReportSubmission()
    report: UniversalReportBody = UniversalReportBody()
    verification: UniversalReportVerification = UniversalReportVerification()


class ContactResolveRequest(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lng: float = Field(..., ge=-180.0, le=180.0)
    category: str = Field(..., pattern="^(pothole|streetlight|trash|graffiti|sidewalk damage|other)$")
    severity: str = "low"


class ContactResolveResponse(BaseModel):
    jurisdiction: str
    department: str
    options: list[SubmissionChannelOut]
    universal_report: UniversalReport


class ContactOut(BaseModel):
    id: int
    organization: str
    department: str | None = None
    jurisdiction_id: str | None = None
    channel_type: str
    value: str
    purpose: str | None = None
    source_url: str | None = None
    source_type: str | None = None
    verification_status: str
    retrieved_at: datetime | None = None
    last_verified_at: datetime | None = None
    handles_categories: list[str] = []
    requires: dict = {}
    notes: str | None = None

    model_config = {"from_attributes": True}


class ComposeRequest(BaseModel):
    channel_type: str | None = None  # defaults to the report's top channel


class DraftOut(BaseModel):
    id: str
    report_id: str
    kind: str
    subject: str
    body: str
    recipient: str | None = None
    user_edited: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ComposeResponse(BaseModel):
    draft: DraftOut
    channel: SubmissionChannelOut
    missing_fields: list[str] = Field(default_factory=list)
    missing_field_keys: list[str] = Field(default_factory=list)


class RegenerateRequest(BaseModel):
    instruction: Literal["make_shorter", "make_more_detailed", "correct"]
    section: Literal["subject", "body"] = "body"
    correction: str | None = None  # required when instruction == "correct"


class DraftPatch(BaseModel):
    subject: str | None = None
    body: str | None = None
    recipient: str | None = None


class SubmissionUpdateRequest(BaseModel):
    channel_type: str
    action: Literal["prepared", "approved", "attempted", "sent"]


class SubmissionUpdateResponse(BaseModel):
    report_id: str
    submission_state: str
    event: "ReportEventOut"


class ReportEventOut(BaseModel):
    id: int
    report_id: str
    event_type: str
    detail: dict
    created_at: datetime

    model_config = {"from_attributes": True}


SubmissionUpdateResponse.model_rebuild()


class CategoryTally(BaseModel):
    category: str
    total: int
    resolved: int


class ImpactOut(BaseModel):
    """City-wide counts for the impact screen (see routers/stats.py)."""

    total_reports: int
    resolved_reports: int
    resolution_rate: float
    avg_days_to_resolve: float | None
    reports_last_30_days: int
    by_status: dict[str, int]
    by_category: list[CategoryTally]
