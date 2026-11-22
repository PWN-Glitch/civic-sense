"""0004: contacts + report_drafts + report_events + reports.submission_state.

Contact Resolver & Report Composer add-on (plan 2026-10-08). Contacts come only
from a verified registry — never fabricated. report_events is the truthful audit
log for submission-assist transitions (distinct from lifecycle status_history).

Revision ID: 0004_contacts
Revises: 0003_photo_kind
Create Date: 2026-10-08
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004_contacts"
down_revision = "0003_photo_kind"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "contacts",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("organization", sa.String(255), nullable=False),
        sa.Column("department", sa.String(255), nullable=True),
        sa.Column("jurisdiction_id", sa.String(64), sa.ForeignKey("jurisdictions.id"), nullable=True),
        sa.Column("channel_type", sa.String(32), nullable=False),
        sa.Column("value", sa.String(1024), nullable=False),
        sa.Column("purpose", sa.String(255), nullable=True),
        sa.Column("source_url", sa.String(1024), nullable=True),
        sa.Column("source_type", sa.String(64), nullable=True),
        sa.Column("verification_status", sa.String(16), nullable=False, server_default="unknown"),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("handles_categories", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("requires", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_contacts_jurisdiction_id", "contacts", ["jurisdiction_id"])
    op.create_index("ix_contacts_channel_type", "contacts", ["channel_type"])

    op.create_table(
        "report_drafts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("report_id", sa.String(36), sa.ForeignKey("reports.id"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False, server_default=""),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("recipient", sa.String(1024), nullable=True),
        sa.Column("user_edited", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_report_drafts_report_id", "report_drafts", ["report_id"])

    op.create_table(
        "report_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("report_id", sa.String(36), sa.ForeignKey("reports.id"), nullable=False),
        sa.Column("event_type", sa.String(48), nullable=False),
        sa.Column("detail", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_report_events_report_id", "report_events", ["report_id"])

    op.add_column(
        "reports",
        sa.Column("submission_state", sa.String(32), nullable=False, server_default="draft"),
    )


def downgrade() -> None:
    op.drop_column("reports", "submission_state")
    op.drop_index("ix_report_events_report_id", table_name="report_events")
    op.drop_table("report_events")
    op.drop_index("ix_report_drafts_report_id", table_name="report_drafts")
    op.drop_table("report_drafts")
    op.drop_index("ix_contacts_channel_type", table_name="contacts")
    op.drop_index("ix_contacts_jurisdiction_id", table_name="contacts")
    op.drop_table("contacts")
