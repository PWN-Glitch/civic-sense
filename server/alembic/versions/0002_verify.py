"""0002: community_verifications gains user_id + unique(user_id, report_id).

One open vote per user per report — re-vote replaces via upsert in the router.
Existing rows (if any) have no user; safest is to clear the table since Week 1
never wrote to it in production paths (no router referenced it).

Revision ID: 0002_verify
Revises: 0001_init
Create Date: 2026-10-08
"""

from alembic import op
import sqlalchemy as sa

revision = "0002_verify"
down_revision = "0001_init"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # No Week-1 writer existed for this table; drop any stray rows so the
    # NOT NULL user_id backfill cannot fail on orphaned data.
    op.execute("DELETE FROM community_verifications")

    op.add_column(
        "community_verifications",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
    )
    op.create_index("ix_community_verifications_user_id", "community_verifications", ["user_id"])
    op.create_index(
        "uq_community_verifications_user_report",
        "community_verifications",
        ["user_id", "report_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_community_verifications_user_report", table_name="community_verifications")
    op.drop_index("ix_community_verifications_user_id", table_name="community_verifications")
    op.drop_column("community_verifications", "user_id")
