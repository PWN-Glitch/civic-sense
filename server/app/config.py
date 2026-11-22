"""Application settings + fail-fast startup validation.

Fail-fast rationale: shipping a dev JWT secret to prod is catastrophic —
anyone can forge sessions. We refuse to boot rather than log a warning,
because warnings are ignorable and a non-booting service is not.
"""

from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# Public, in-tree placeholder. Anyone reading the repo can see this string;
# if it's ever used to sign tokens in prod, those tokens are forgeable.
DEV_JWT_SECRET = "dev-secret-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+asyncpg://civicsense:civicsense@localhost:5433/civicsense"
    jwt_secret: str = DEV_JWT_SECRET
    google_client_id: str = ""
    upload_dir: Path = Path("./uploads")
    dev_auth_bypass: bool = False
    # Anything but an explicit development/test marker counts as production.
    app_env: Literal["development", "test", "production"] = "production"

    # Test database used by pytest (PostGIS-enabled).
    test_database_url: str = "postgresql+asyncpg://civicsense:civicsense@localhost:5433/civicsense_test"

    def validate_production_secrets(self) -> None:
        """Raise RuntimeError if the configuration is unsafe for production.

        Called by get_settings() at import time so the app refuses to boot.
        The rules: the dev auth bypass only runs where APP_ENV says this is
        development or test, and with the bypass off (real Google
        verification) the JWT secret must NOT be the in-tree placeholder.
        """
        if self.dev_auth_bypass and self.app_env == "production":
            raise RuntimeError(
                "Refusing to boot: DEV_AUTH_BYPASS=true lets anyone sign in without "
                "Google. Set APP_ENV=development (or test) on a dev machine, or turn "
                "the bypass off."
            )
        if not self.dev_auth_bypass and self.jwt_secret == DEV_JWT_SECRET:
            raise RuntimeError(
                "Refusing to boot: DEV_AUTH_BYPASS=false but JWT_SECRET is "
                f"still the in-tree dev placeholder ({DEV_JWT_SECRET!r}). "
                "Generate a real secret with "
                "`python -c \"import secrets; print(secrets.token_urlsafe(48))\"` "
                "and set JWT_SECRET in .env (see .env.example)."
            )


def get_settings() -> Settings:
    s = Settings()
    s.validate_production_secrets()
    return s


settings = get_settings()
