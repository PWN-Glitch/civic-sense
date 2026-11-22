"""0003: photos.kind — before | progress | after (default 'before').

Revision ID: 0003_photo_kind
Revises: 0002_verify
Create Date: 2026-10-08
"""

from alembic import op
import sqlalchemy as sa

revision = "0003_photo_kind"
down_revision = "0002_verify"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "photos",
        sa.Column("kind", sa.String(16), nullable=False, server_default="before"),
    )


def downgrade() -> None:
    op.drop_column("photos", "kind")
