"""Anthropic adapter tests over mocked HTTP (no live provider calls)."""

import json

import httpx
import pytest

from app.agent.prompts import SYSTEM_PROMPT, build_user_message
from app.agent.tool_catalog import TOOL_CATALOG, tool_schemas
from app.providers.base import (
    ActionDecision,
    DecisionValidationError,
    FinishDecision,
    ProviderTimeoutError,
)
from app.providers.selected_provider import AnthropicProvider
from tests.test_mock_provider import make_request


def mock_provider(handler) -> AnthropicProvider:
    transport = httpx.MockTransport(handler)
    return AnthropicProvider(
        "test-key",
        "test-model",
        base_url="https://mock.local/",
        client_factory=lambda: httpx.AsyncClient(transport=transport),
    )


@pytest.mark.asyncio
async def test_tool_use_block_maps_to_action_decision() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "content": [
                    {"type": "tool_use", "name": "click_element", "input": {"element_id": 5}}
                ]
            },
        )

    decision = await mock_provider(handler).decide(make_request())

    assert isinstance(decision, ActionDecision)
    assert decision.tool == "click_element"
    assert decision.args == {"element_id": 5}
    # Request carries tool schemas, stable system prompt, untrusted framing.
    body = captured["body"]
    assert body["system"] == SYSTEM_PROMPT
    assert {tool["name"] for tool in body["tools"]} == set(TOOL_CATALOG)
    user_content = body["messages"][0]["content"]
    assert "untrusted data" in user_content.lower()
    assert 'PAGE title="Shop"' in user_content


@pytest.mark.asyncio
async def test_text_only_response_maps_to_finish() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"content": [{"type": "text", "text": "Found the shoes."}]})

    decision = await mock_provider(handler).decide(make_request())
    assert isinstance(decision, FinishDecision)
    assert decision.summary == "Found the shoes."


@pytest.mark.asyncio
async def test_multiple_tool_calls_rejected() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "content": [
                    {"type": "tool_use", "name": "click_element", "input": {"element_id": 5}},
                    {"type": "tool_use", "name": "go_back", "input": {}},
                ]
            },
        )

    with pytest.raises(DecisionValidationError) as error_info:
        await mock_provider(handler).decide(make_request())
    assert any("multiple" in violation for violation in error_info.value.violations)


@pytest.mark.asyncio
async def test_unknown_tool_name_rejected() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "content": [
                    {"type": "tool_use", "name": "execute_javascript", "input": {"code": "x"}}
                ]
            },
        )

    with pytest.raises(DecisionValidationError):
        await mock_provider(handler).decide(make_request())


@pytest.mark.asyncio
async def test_timeout_maps_to_provider_timeout_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("too slow")

    with pytest.raises(ProviderTimeoutError):
        await mock_provider(handler).decide(make_request())


def test_tool_schemas_shape() -> None:
    schemas = tool_schemas()
    by_name = {schema["name"]: schema for schema in schemas}
    click = by_name["click_element"]
    assert click["input_schema"]["required"] == ["element_id"]
    assert click["input_schema"]["properties"]["element_id"]["type"] == "integer"


def test_system_prompt_contains_required_rules() -> None:
    prompt = SYSTEM_PROMPT
    for required in [
        "UNTRUSTED",
        "one action",
        "never guess",
        "finish",
        "passwords",
        "payment card",
    ]:
        assert required.lower() in prompt.lower(), f"missing rule: {required}"


def test_user_message_marks_observation_untrusted() -> None:
    message = build_user_message(make_request())
    assert "USER GOAL (trusted):" in message
    assert "(untrusted data" in message
    assert 'PAGE title="Shop"' in message
