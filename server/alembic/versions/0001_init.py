"""init: postgis extension + 9 tables

Revision ID: 0001_init
Revises:
Create Date: 2026-10-07
"""

from alembic import op
import geoalchemy2
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_init"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("google_sub", sa.String(255), nullable=False, unique=True),
        sa.Column("display_name", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_users_google_sub", "users", ["google_sub"], unique=True)

    op.create_table(
        "jurisdictions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("geo_boundary", postgresql.JSONB, nullable=True),
        sa.Column("adapter_type", sa.String(64), nullable=False),
        sa.Column("adapter_config", postgresql.JSONB, nullable=True),
    )

    op.create_table(
        "departments",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "jurisdiction_id", sa.String(64), sa.ForeignKey("jurisdictions.id"), nullable=False
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("handles_categories", postgresql.JSONB, nullable=False),
    )
    op.create_index("ix_departments_jurisdiction_id", "departments", ["jurisdiction_id"])

    op.create_table(
        "reports",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("category", sa.String(32), nullable=False),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("lat", sa.Float, nullable=False),
        sa.Column("lng", sa.Float, nullable=False),
        sa.Column("location_accuracy", sa.Float, nullable=True),
        sa.Column("severity", sa.String(32), nullable=False, server_default="low"),
        sa.Column("status", sa.String(32), nullable=False, server_default="Draft"),
        sa.Column("reporter_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("jurisdiction_id", sa.String(64), sa.ForeignKey("jurisdictions.id"), nullable=True),
        sa.Column("department_id", sa.Integer, sa.ForeignKey("departments.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("geom", geoalchemy2.Geometry(geometry_type="POINT", srid=4326), nullable=True),
    )
    op.create_index("ix_reports_category", "reports", ["category"])
    op.create_index("ix_reports_status", "reports", ["status"])
    op.create_index("ix_reports_reporter_id", "reports", ["reporter_id"])
    op.create_index("ix_reports_geom_gist", "reports", ["geom"], postgresql_using="gist")

    op.create_table(
        "ai_predictions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("report_id", sa.String(36), sa.ForeignKey("reports.id"), nullable=False),
        sa.Column("model_version", sa.String(64), nullable=False),
        sa.Column("category", sa.String(32), nullable=False),
        sa.Column("confidence", sa.Float, nullable=False),
        sa.Column("severity_estimate", sa.String(32), nullable=False),
        sa.Column("raw_scores", postgresql.JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ai_predictions_report_id", "ai_predictions", ["report_id"])

    op.create_table(
        "user_confirmations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("report_id", sa.String(36), sa.ForeignKey("reports.id"), nullable=False),
        sa.Column("confirmed_category", sa.String(32), nullable=False),
        sa.Column("corrected", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_user_confirmations_report_id", "user_confirmations", ["report_id"])

    op.create_table(
        "report_status_history",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("report_id", sa.String(36), sa.ForeignKey("reports.id"), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("source", sa.String(64), nullable=False, server_default="user"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_report_status_history_report_id", "report_status_history", ["report_id"])

    op.create_table(
        "community_verifications",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("report_id", sa.String(36), sa.ForeignKey("reports.id"), nullable=False),
        sa.Column("response", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_community_verifications_report_id", "community_verifications", ["report_id"])

    op.create_table(
        "photos",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("report_id", sa.String(36), sa.ForeignKey("reports.id"), nullable=True),
        sa.Column("storage_key", sa.String(512), nullable=False),
        sa.Column("exif_stripped", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("blurred", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_photos_report_id", "photos", ["report_id"])


def downgrade() -> None:
    op.drop_table("photos")
    op.drop_table("community_verifications")
    op.drop_table("report_status_history")
    op.drop_table("user_confirmations")
    op.drop_table("ai_predictions")
    op.drop_table("reports")
    op.drop_table("departments")
    op.drop_table("jurisdictions")
    op.drop_table("users")
