"""Deterministic mock provider for Milestone 4 (docs/09 §7).

Two modes:
- built-in "click_first_button" strategy: click the lowest-ID button in the
  latest observation, then finish - proves the full loop on any page;
- explicit script: a replayed list of decisions for deterministic tests.
"""

import asyncio
import logging

from app.providers.base import (
    ActionDecision,
    AgentDecision,
    AgentDecisionRequest,
    FinishDecision,
)

logger = logging.getLogger(__name__)


class MockProvider:
    def __init__(
        self,
        script: list[AgentDecision] | None = None,
        strategy: str = "click_first_button",
    ) -> None:
        self._script = list(script) if script is not None else None
        self._strategy = strategy

    async def decide(self, request: AgentDecisionRequest) -> AgentDecision:
        # E2E hook: goals containing "[slow]" stall so cancellation can be
        # exercised deterministically.
        if "[slow]" in request.goal:
            await asyncio.sleep(600)
            return FinishDecision(summary="slow mock finished")

        if self._script is not None:
            if not self._script:
                return FinishDecision(summary="Mock script exhausted.")
            return self._script.pop(0)

        if self._strategy != "click_first_button":
            return FinishDecision(summary=f"Unknown mock strategy {self._strategy}.")

        button_ids = sorted(
            int(element_id)
            for element_id, fingerprint in request.observation.actionable_fingerprints.items()
            if fingerprint.role == "button"
        )
        already_clicked = any(
            step.action is not None and step.action.get("tool") == "click_element"
            for step in request.history
        )
        if button_ids and not already_clicked:
            return ActionDecision(tool="click_element", args={"element_id": button_ids[0]})
        return FinishDecision(summary="Mock task complete.")
