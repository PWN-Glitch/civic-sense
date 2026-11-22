"""Boot-time guards in app.config."""

from __future__ import annotations

import pytest

from app.config import DEV_JWT_SECRET, Settings


def _settings(**overrides) -> Settings:
    # _env_file=None and explicit values keep the developer's own .env out of the test.
    base = {"jwt_secret": "x" * 48, "dev_auth_bypass": False, "app_env": "production"}
    return Settings(_env_file=None, **{**base, **overrides})


def test_app_env_defaults_to_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("APP_ENV", raising=False)
    assert Settings(_env_file=None).app_env == "production"


def test_dev_auth_bypass_refused_in_production() -> None:
    with pytest.raises(RuntimeError, match="APP_ENV"):
        _settings(dev_auth_bypass=True).validate_production_secrets()


@pytest.mark.parametrize("env", ["development", "test"])
def test_dev_auth_bypass_allowed_in_dev_and_test(env: str) -> None:
    _settings(dev_auth_bypass=True, app_env=env, jwt_secret=DEV_JWT_SECRET).validate_production_secrets()


def test_placeholder_secret_still_refused_without_bypass() -> None:
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        _settings(jwt_secret=DEV_JWT_SECRET).validate_production_secrets()
