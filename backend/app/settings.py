"""Single typed settings object (docs/05 §10).

All configuration arrives via environment variables. LLM_API_KEY is a SecretStr
and must never be logged (docs/10 §10).
"""

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    log_level: str = "INFO"

    # LLM provider is not wired until Milestone 5; absence is valid until then.
    llm_provider: str | None = None
    llm_model: str | None = None
    llm_api_key: SecretStr | None = None

    # Comma-separated origins allowed to open WebSocket/HTTP connections.
    # Production value is a deployment decision (docs/05 §17, OPEN-001/002).
    allowed_extension_origins: str = ""

    task_max_steps: int = 25
    model_timeout_seconds: float = 30.0

    # Timeouts are configuration, not magic values (docs/05 §12).
    websocket_heartbeat_seconds: float = 20.0
    task_idle_timeout_seconds: float = 600.0
    confirmation_timeout_seconds: float = 120.0

    # Milestone 4 runs the deterministic mock provider; the real adapter
    # arrives with docs/09 Milestone 5.
    llm_provider_default: str = "mock"

    # Override the provider endpoint (e.g. OpenRouter:
    # LLM_BASE_URL=https://openrouter.ai/api/v1).
    llm_base_url: str | None = None

    def allowed_origins_list(self) -> list[str]:
        origins = self.allowed_extension_origins.split(",")
        return [origin.strip() for origin in origins if origin.strip()]


def get_settings() -> Settings:
    return Settings()
