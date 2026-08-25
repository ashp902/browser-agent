"""Mock provider strategy tests."""

import pytest

from app.providers.base import (
    ActionDecision,
    AgentDecisionRequest,
    FinishDecision,
)
from app.providers.mock import MockProvider
from tests.test_ws_endpoint import observation_payload


def make_request(with_button: bool = True) -> AgentDecisionRequest:
    snapshot_model = observation_payload()["snapshot"]
    if not with_button:
        snapshot_model["actionable_fingerprints"] = {}
    from pydantic import TypeAdapter

    from app.protocols.events import ObservationPayload

    adapter = TypeAdapter(ObservationPayload)
    payload = adapter.validate_python({"snapshot": snapshot_model})
    return AgentDecisionRequest(goal="demo", observation=payload.snapshot)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_default_strategy_clicks_first_button_then_finishes() -> None:
    from app.sessions.models import StepRecord

    provider = MockProvider()
    first = await provider.decide(make_request())
    assert isinstance(first, ActionDecision)
    assert first.tool == "click_element"
    assert first.args == {"element_id": 5}

    # The second decision sees the recorded click in history and finishes.
    history = [StepRecord(step=1, action={"tool": "click_element", "args": {"element_id": 5}})]
    request_with_history = AgentDecisionRequest(
        goal="demo", observation=make_request().observation, history=history
    )
    second = await provider.decide(request_with_history)
    assert isinstance(second, FinishDecision)


@pytest.mark.asyncio
async def test_strategy_finishes_when_no_button_exists() -> None:
    provider = MockProvider()
    decision = await provider.decide(make_request(with_button=False))
    assert isinstance(decision, FinishDecision)


@pytest.mark.asyncio
async def test_explicit_script_replays_then_finishes() -> None:
    click = ActionDecision(tool="go_back", args={})
    finish = FinishDecision(summary="done")
    provider = MockProvider(script=[click, finish])
    assert await provider.decide(make_request()) is click
    replayed = await provider.decide(make_request())
    assert isinstance(replayed, FinishDecision)
    assert replayed.summary == finish.summary
    third = await provider.decide(make_request())
    assert isinstance(third, FinishDecision)
