"""0007: reports.client_ref — idempotent report creation for retried submits.

Revision ID: 0007_report_client_ref
Revises: 0006_photo_uploader
Create Date: 2026-11-21
"""

from alembic import op
import sqlalchemy as sa

revision = "0007_report_client_ref"
down_revision = "0006_photo_uploader"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("reports", sa.Column("client_ref", sa.String(64), nullable=True))
    # NULLs never collide, so existing reports need no backfill.
    op.create_index(
        "uq_reports_reporter_client_ref", "reports", ["reporter_id", "client_ref"], unique=True
    )


def downgrade() -> None:
    op.drop_index("uq_reports_reporter_client_ref", table_name="reports")
    op.drop_column("reports", "client_ref")
