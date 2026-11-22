"""0005: email/password auth — users.email + users.password_hash, google_sub nullable.

Adds Bitwarden-style email+password auth alongside the existing Google sign-in.
``email`` and ``password_hash`` are nullable so Google-only users keep working;
``google_sub`` becomes nullable so email-only users don't need it. All three
columns stay nullable — identity is "at least one of (google_sub, email)".

Revision ID: 0005_email_auth
Revises: 0004_contacts
Create Date: 2026-10-09
"""

from alembic import op
import sqlalchemy as sa

revision = "0005_email_auth"
down_revision = "0004_contacts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("email", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("password_hash", sa.String(255), nullable=True))
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.alter_column("users", "google_sub", nullable=True)


def downgrade() -> None:
    # Only safe to restore NOT NULL if no email-only users exist.
    op.alter_column("users", "google_sub", nullable=False)
    op.drop_index("ix_users_email", table_name="users")
    op.drop_column("users", "password_hash")
    op.drop_column("users", "email")
