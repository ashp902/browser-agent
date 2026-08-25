from fastapi.testclient import TestClient

from app.main import create_app


def test_healthz() -> None:
    client = TestClient(create_app())
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readyz() -> None:
    client = TestClient(create_app())
    response = client.get("/readyz")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_settings_defaults_match_spec() -> None:
    from app.settings import Settings

    # Ignore any local backend/.env so pure defaults are asserted.
    settings = Settings(_env_file=None)
    assert settings.task_max_steps == 25
    assert settings.model_timeout_seconds == 30.0
    assert settings.llm_api_key is None


def test_settings_never_expose_api_key_in_repr() -> None:
    from pydantic import SecretStr

    from app.settings import Settings

    settings = Settings(_env_file=None, llm_api_key=SecretStr("fake-test-key-not-real"))
    assert "fake-test-key-not-real" not in repr(settings)
    assert "fake-test-key-not-real" not in str(settings)
