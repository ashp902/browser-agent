"""OpenAI-compatible adapter tests (OpenRouter wire shape) over mocked HTTP."""

import json

import httpx
import pytest

from app.providers.base import (
    ActionDecision,
    DecisionValidationError,
    FinishDecision,
    ProviderTimeoutError,
)
from app.providers.openai_compat import OPENROUTER_BASE_URL, OpenAICompatibleProvider
from tests.test_mock_provider import make_request


def provider(handler) -> OpenAICompatibleProvider:
    transport = httpx.MockTransport(handler)
    return OpenAICompatibleProvider(
        "test-key",
        "test-model",
        base_url="https://mock.local/v1",
        client_factory=lambda: httpx.AsyncClient(transport=transport),
    )


def chat_response(message: dict) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": message}]})


@pytest.mark.asyncio
async def test_tool_call_maps_to_action_decision() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return chat_response(
            {
                "tool_calls": [
                    {"function": {"name": "click_element", "arguments": '{"element_id": 5}'}}
                ]
            }
        )

    decision = await provider(handler).decide(make_request())

    assert isinstance(decision, ActionDecision)
    assert decision.tool == "click_element"
    assert decision.args == {"element_id": 5}

    body = captured["body"]
    # Bearer auth, system prompt isolation, and function tool schemas.
    assert request_bearer(body) is None  # auth checked via headers below
    tools = body["tools"]
    assert tools[0]["type"] == "function"
    assert "click_element" in {t["function"]["name"] for t in tools}
    assert body["messages"][0]["role"] == "system"


def request_bearer(body: dict) -> str | None:
    return None


@pytest.mark.asyncio
async def test_bearer_header_present() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization")
        return chat_response({"content": "done"})

    await provider(handler).decide(make_request())
    assert seen["auth"] == "Bearer test-key"


@pytest.mark.asyncio
async def test_text_only_response_maps_to_finish() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return chat_response({"content": "Found the shoes."})

    decision = await provider(handler).decide(make_request())
    assert isinstance(decision, FinishDecision)
    assert decision.summary == "Found the shoes."


@pytest.mark.asyncio
async def test_multiple_tool_calls_rejected() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return chat_response(
            {
                "tool_calls": [
                    {"function": {"name": "click_element", "arguments": "{}"}},
                    {"function": {"name": "go_back", "arguments": "{}"}},
                ]
            }
        )

    with pytest.raises(DecisionValidationError) as error_info:
        await provider(handler).decide(make_request())
    assert any("multiple" in v for v in error_info.value.violations)


@pytest.mark.asyncio
async def test_non_json_arguments_rejected() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return chat_response(
            {"tool_calls": [{"function": {"name": "click_element", "arguments": "not-json"}}]}
        )

    with pytest.raises(DecisionValidationError):
        await provider(handler).decide(make_request())


@pytest.mark.asyncio
async def test_unknown_tool_rejected() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return chat_response({"tool_calls": [{"function": {"name": "run_cdp", "arguments": "{}"}}]})

    with pytest.raises(DecisionValidationError):
        await provider(handler).decide(make_request())


@pytest.mark.asyncio
async def test_http_error_rejected_for_repair() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    with pytest.raises(DecisionValidationError):
        await provider(handler).decide(make_request())


@pytest.mark.asyncio
async def test_timeout_maps_to_provider_timeout_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("slow")

    p = OpenAICompatibleProvider(
        "k",
        "m",
        base_url="https://mock.local/v1",
        timeout_seconds=0.01,
        client_factory=lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    with pytest.raises(ProviderTimeoutError):
        await p.decide(make_request())


def test_default_base_url_is_openrouter() -> None:
    assert OPENROUTER_BASE_URL == "https://openrouter.ai/api/v1"
