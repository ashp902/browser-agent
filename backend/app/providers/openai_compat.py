"""OpenAI-compatible chat-completions adapter (OpenRouter and friends).

Covers providers exposing POST {base_url}/chat/completions with Bearer auth
and function tool calling - e.g. OpenRouter (https://openrouter.ai/api/v1)
or the OpenAI API itself. Provider-specific shapes stay isolated here
(docs/10 §5); the orchestrator sees project-native decisions only.
"""

import json
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

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
MAX_SUMMARY_CHARS = 500


def openai_tool_schemas(tools: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    """OpenAI/OpenRouter function-tool definitions built from our catalog."""
    names = tools or tuple(TOOL_CATALOG)
    schemas: list[dict[str, Any]] = []
    for name in names:
        spec = TOOL_CATALOG[name]
        schemas.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": spec.description,
                    "parameters": {
                        "type": "object",
                        "properties": {
                            key: value
                            for key, value in spec.parameters.items()
                            if key != "required"
                        },
                        "required": spec.parameters.get("required", []),
                    },
                },
            }
        )
    return schemas


class OpenAICompatibleProvider:
    def __init__(
        self,
        api_key: str,
        model: str,
        timeout_seconds: float = 30.0,
        base_url: str = OPENROUTER_BASE_URL,
        client_factory: Callable[[], httpx.AsyncClient] | None = None,
    ) -> None:
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.base_url = base_url.rstrip("/")
        self._client_factory = client_factory or (
            lambda: httpx.AsyncClient(timeout=timeout_seconds)
        )
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "content-type": "application/json",
        }

    async def decide(self, request: AgentDecisionRequest) -> AgentDecision:
        body: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 1024,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": build_user_message(request)},
            ],
            "tools": openai_tool_schemas(request.tools),
        }

        try:
            async with self._client_factory() as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=self._headers,
                    json=body,
                )
        except httpx.TimeoutException as error:
            raise ProviderTimeoutError() from error

        if response.status_code != 200:
            raise DecisionValidationError([f"provider returned HTTP {response.status_code}"])

        data = response.json()
        try:
            message = data["choices"][0]["message"]
        except (KeyError, IndexError, TypeError) as error:
            raise DecisionValidationError(["provider response had no message"]) from error

        return self._parse_message(message)

    def _parse_message(self, message: dict[str, Any]) -> AgentDecision:
        tool_calls = message.get("tool_calls") or []
        if len(tool_calls) > 1:
            raise DecisionValidationError(["multiple simultaneous tool calls"])

        if not tool_calls:
            summary = (message.get("content") or "").strip()[:MAX_SUMMARY_CHARS]
            if not summary:
                raise DecisionValidationError(["no tool call and no finish summary"])
            return FinishDecision(summary=summary)

        call = tool_calls[0].get("function", {})
        name = call.get("name")
        violations: list[str] = []
        if name not in TOOL_CATALOG:
            violations.append(f"unknown tool '{name}'")

        raw_arguments = call.get("arguments")
        args: dict[str, Any] = {}
        if isinstance(raw_arguments, str):
            try:
                parsed = json.loads(raw_arguments)
            except json.JSONDecodeError:
                violations.append("tool arguments were not valid JSON")
                parsed = None
            if parsed is not None and not isinstance(parsed, dict):
                violations.append("tool arguments must decode to an object")
            elif isinstance(parsed, dict):
                args = parsed
        elif isinstance(raw_arguments, dict):
            args = raw_arguments
        elif raw_arguments is None:
            violations.append("missing tool arguments")

        if violations:
            raise DecisionValidationError(violations)
        return ActionDecision(tool=name, args=args)
