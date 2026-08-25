"""Browser Agent backend application entrypoint.

Milestone 4 scope: application factory, health endpoints (docs/05 §16), and
the agent WebSocket with a deterministic mock provider (docs/09 §7).
"""

from collections.abc import Callable
from dataclasses import dataclass

from fastapi import FastAPI

from app.policy.engine import PolicyEngine
from app.providers.base import LLMProvider
from app.providers.mock import MockProvider
from app.providers.openai_compat import OPENROUTER_BASE_URL, OpenAICompatibleProvider
from app.providers.selected_provider import AnthropicProvider
from app.sessions.store import InMemorySessionStore, SessionStore
from app.settings import Settings, get_settings


@dataclass(slots=True)
class Runtime:
    """Dependency container; provider/store/policy are injectable for tests."""

    settings: Settings
    store: SessionStore
    policy: PolicyEngine
    provider_factory: Callable[[], LLMProvider]


def build_runtime(settings: Settings | None = None) -> Runtime:
    resolved = settings or get_settings()
    store = InMemorySessionStore()
    policy = PolicyEngine()

    def provider_factory() -> LLMProvider:
        # Provider selection is isolated here (docs/10 §5).
        selection = resolved.llm_provider or (
            "anthropic" if resolved.llm_api_key is not None else "mock"
        )
        if selection == "mock":
            return MockProvider()
        if selection == "anthropic":
            if resolved.llm_api_key is None:
                raise RuntimeError("LLM_PROVIDER=anthropic requires LLM_API_KEY")
            if not resolved.llm_model:
                raise RuntimeError("LLM_PROVIDER=anthropic requires LLM_MODEL")
            return AnthropicProvider(
                api_key=resolved.llm_api_key.get_secret_value(),
                model=resolved.llm_model,
                timeout_seconds=resolved.model_timeout_seconds,
            )
        if selection in ("openrouter", "openai"):
            if resolved.llm_api_key is None:
                raise RuntimeError(f"LLM_PROVIDER={selection} requires LLM_API_KEY")
            if not resolved.llm_model:
                raise RuntimeError(f"LLM_PROVIDER={selection} requires LLM_MODEL")
            base_url = resolved.llm_base_url or (
                OPENROUTER_BASE_URL if selection == "openrouter" else "https://api.openai.com/v1"
            )
            return OpenAICompatibleProvider(
                api_key=resolved.llm_api_key.get_secret_value(),
                model=resolved.llm_model,
                timeout_seconds=resolved.model_timeout_seconds,
                base_url=base_url,
            )
        raise ValueError(f"Unknown LLM_PROVIDER: {selection}")

    return Runtime(settings=resolved, store=store, policy=policy, provider_factory=provider_factory)


def create_app(runtime: Runtime | None = None) -> FastAPI:
    resolved_runtime = runtime or build_runtime()
    app = FastAPI(title="Browser Agent Backend", version="0.1.0")
    app.state.runtime = resolved_runtime

    from app.api.websocket import router as ws_router

    app.include_router(ws_router)

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz")
    async def readyz() -> dict[str, str]:
        return {"status": "ready"}

    return app


app = create_app()
