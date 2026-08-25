"""Selected development provider: Anthropic Messages API (docs/09 Milestone 5,
OPEN-003).

Provider-specific shapes are isolated here. The rest of the backend sees only
project-native AgentDecision objects. Uses plain httpx rather than an SDK to
keep dependencies minimal and the boundary explicit.
"""

from collections.abc import Callable
from typing import Any

import httpx

from app.agent.prompts import SYSTEM_PROMPT, build_user_message
from app.agent.tool_catalog import TOOL_CATALOG
from app.providers.base import (
    ActionDecision,
    AgentDecision,
    AgentDecisionRequest,
    DecisionValidationError,
    FinishDecision,
    ProviderTimeoutError,
)

ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
MAX_SUMMARY_CHARS = 500


def tool_schemas(tools: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    """Anthropic tool definitions built from our catalog."""
    names = tools or tuple(TOOL_CATALOG)
    return [
        {
            "name": name,
            "description": TOOL_CATALOG[name].description,
            "input_schema": {
                "type": "object",
                "properties": {
                    key: value
                    for key, value in TOOL_CATALOG[name].parameters.items()
                    if key != "required"
                },
                "required": TOOL_CATALOG[name].parameters.get("required", []),
            },
        }
        for name in names
        if name in TOOL_CATALOG
    ]


class AnthropicProvider:
    def __init__(
        self,
        api_key: str,
        model: str,
        timeout_seconds: float = 30.0,
        base_url: str = ANTHROPIC_MESSAGES_URL,
        client_factory: Callable[[], httpx.AsyncClient] | None = None,
    ) -> None:
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.base_url = base_url
        # Injectable for tests; production uses plain httpx clients.
        self._client_factory = client_factory or (
            lambda: httpx.AsyncClient(timeout=timeout_seconds)
        )
        self._headers = {
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }

    async def decide(self, request: AgentDecisionRequest) -> AgentDecision:
        body: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 1024,
            "system": SYSTEM_PROMPT,
            "tools": tool_schemas(request.tools),
            "messages": [
                {"role": "user", "content": build_user_message(request)},
            ],
        }

        try:
            async with self._client_factory() as client:
                response = await client.post(self.base_url, headers=self._headers, json=body)
        except httpx.TimeoutException as error:
            raise ProviderTimeoutError() from error

        if response.status_code != 200:
            # Non-retryable provider failure surfaces as a validation error so
            # the orchestrator's repair path reports it cleanly.
            raise DecisionValidationError([f"provider returned HTTP {response.status_code}"])

        data = response.json()
        return self._parse_content(data.get("content", []))

    def _parse_content(self, content: list[dict[str, Any]]) -> AgentDecision:
        tool_uses = [block for block in content if block.get("type") == "tool_use"]
        if len(tool_uses) > 1:
            raise DecisionValidationError(["multiple simultaneous tool calls"])

        if not tool_uses:
            text = "".join(
                block.get("text", "") for block in content if block.get("type") == "text"
            ).strip()
            summary = text[:MAX_SUMMARY_CHARS]
            if not summary:
                raise DecisionValidationError(["no tool call and no finish summary"])
            return FinishDecision(summary=summary)

        block = tool_uses[0]
        name = block.get("name")
        args = block.get("input")
        violations: list[str] = []
        if name not in TOOL_CATALOG:
            violations.append(f"unknown tool '{name}'")
        if not isinstance(args, dict):
            violations.append("tool input must be an object")
        if violations:
            raise DecisionValidationError(violations)
        return ActionDecision(tool=name, args=args)
