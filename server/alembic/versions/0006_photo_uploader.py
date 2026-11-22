"""0006: photos.uploader_id — only the uploader may attach a photo to a report.

Existing rows keep NULL: photos already on a report stay there, and unattached
legacy uploads can no longer be attached by anyone.

Revision ID: 0006_photo_uploader
Revises: 0005_email_auth
Create Date: 2026-11-21
"""

from alembic import op
import sqlalchemy as sa

revision = "0006_photo_uploader"
down_revision = "0005_email_auth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "photos",
        sa.Column("uploader_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("photos", "uploader_id")
