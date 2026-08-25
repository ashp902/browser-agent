"""Orchestrator loop tests with a scripted mock provider and fake connection."""

import asyncio
import json
from dataclasses import dataclass, field
from uuid import uuid4

import pytest

from app.agent.orchestrator import Orchestrator
from app.policy.engine import PolicyEngine
from app.protocols.actions import ActionResultModel
from app.protocols.events import (
    ActionRequestPayload,
    ActionResultClientPayload,
    ObservationPayload,
    TaskCompletedPayload,
)
from app.protocols.observations import ObservationSnapshot, SnapshotStats
from app.providers.base import (
    ActionDecision,
    AgentDecision,
    AgentDecisionRequest,
    FinishDecision,
)
from app.sessions.models import AgentSession


def make_snapshot(
    document_id: str = "doc-1",
    epoch: int = 7,
    button_ids: tuple[int, ...] = (5,),
) -> ObservationSnapshot:
    return ObservationSnapshot(
        document_id=document_id,
        snapshot_id=f"snap-{uuid4()}",
        mutation_epoch=epoch,
        url="https://shop.example/",
        origin="https://shop.example",
        title="Shop",
        semantic_text='PAGE title="Shop"',
        actionable_fingerprints={
            str(i): {
                "role": "button",
                "normalized_name": "buy",
                "tag_name": "button",
            }
            for i in button_ids
        },
        stats=SnapshotStats(
            node_count=4,
            actionable_count=len(button_ids),
            truncated_nodes=0,
            snapshot_truncated=False,
            serialized_chars=40,
        ),
    )


@dataclass
class FakeConn:
    sent: list[tuple[str, object]] = field(default_factory=list)
    events: asyncio.Queue = field(default_factory=asyncio.Queue)

    async def send_server_event(self, type_: str, payload: object) -> None:
        self.sent.append((type_, payload))

    async def next_event(self):
        item = await self.events.get()
        if item is None:
            from app.agent.orchestrator import ConnectionClosedError

            raise ConnectionClosedError()
        return item


class ScriptedProvider:
    def __init__(self, decisions: list[AgentDecision]) -> None:
        self.decisions = list(decisions)

    async def decide(self, request: AgentDecisionRequest) -> AgentDecision:
        if not self.decisions:
            return FinishDecision(summary="script exhausted")
        return self.decisions.pop(0)


async def wait_for_sent(conn: FakeConn, type_: str, budget: float = 2.0):
    """Waits for the FIRST event of the type."""
    payloads = await wait_for_sent_all(conn, type_, 1, budget)
    return payloads[0]


async def wait_for_sent_all(conn: FakeConn, type_: str, count: int, budget: float = 2.0):
    """Waits until `count` events of the type have been sent; returns them all."""

    async def poll() -> list:
        while True:
            matches = [payload for name, payload in conn.sent if name == type_]
            if len(matches) >= count:
                return matches
            await asyncio.sleep(0.005)

    return await asyncio.wait_for(poll(), budget)


async def deliver_observation(conn: FakeConn, snapshot=None) -> None:
    await conn.events.put(
        IncomingEvent(
            type="observation", payload=ObservationPayload(snapshot=snapshot or make_snapshot())
        )
    )


def start_session(max_steps: int = 25) -> AgentSession:
    return AgentSession(task_id=uuid4(), user_goal="Demo goal", max_steps=max_steps)


async def run_happy_path() -> tuple[AgentSession, FakeConn]:
    orchestrator = Orchestrator(
        provider=ScriptedProvider(
            [
                ActionDecision(tool="click_element", args={"element_id": 5}),
                FinishDecision(summary="Found the product."),
            ]
        ),
        policy=PolicyEngine(),
    )
    conn = FakeConn()
    session = start_session()
    runner = asyncio.create_task(orchestrator.run(session, conn))

    await wait_for_sent(conn, "request_observation")
    await deliver_observation(conn)

    request_payload = await wait_for_sent(conn, "action_request")
    assert isinstance(request_payload, ActionRequestPayload)
    result_model = ActionResultModel(
        action_id=request_payload.action.action_id,
        document_id=request_payload.action.document_id,
        mutation_epoch_before=request_payload.action.observed_mutation_epoch,
        mutation_epoch_after=request_payload.action.observed_mutation_epoch + 1,
        ok=True,
        changed=True,
        summary='Clicked button "Buy".',
    )
    await conn.events.put(
        IncomingEvent(type="action_result", payload=ActionResultClientPayload(result=result_model))
    )

    observation_requests = await wait_for_sent_all(conn, "request_observation", 2)
    reasons = [r.reason for r in observation_requests]
    assert reasons == ["initial", "after_action"]

    await deliver_observation(conn)
    completed = await wait_for_sent(conn, "task_completed")
    await runner
    assert isinstance(completed, TaskCompletedPayload)
    return session, conn


from app.agent.orchestrator import IncomingEvent  # noqa: E402


@pytest.mark.asyncio
async def test_happy_path_binds_and_completes_with_trace() -> None:
    session, conn = await run_happy_path()
    assert session.status.value == "COMPLETED"

    action_requests = [p for t, p in conn.sent if t == "action_request"]
    assert len(action_requests) == 1
    request = action_requests[0]
    # The request is bound to the observation the decider saw.
    assert request.action.document_id == "doc-1"
    assert request.action.observed_mutation_epoch == 7
    assert request.action.expected_target is not None
    assert request.action.expected_target.normalized_name == "buy"
    assert request.policy == "ALLOW"
    # Only one pending action ever existed at a time.
    assert session.pending_action is None

    completed = next(p for t, p in conn.sent if t == "task_completed")
    trace = json.dumps(completed.trace)
    assert completed.metrics["steps"] == 2
    assert '"error_code"' not in trace or completed.trace["steps"][0].get("error_code") is None
    assert completed.trace["terminal_reason"] == "finish"


@pytest.mark.asyncio
async def test_stale_failure_reobserves() -> None:
    orchestrator = Orchestrator(
        provider=ScriptedProvider([ActionDecision(tool="click_element", args={"element_id": 5})]),
        policy=PolicyEngine(),
    )
    conn = FakeConn()
    session = start_session()
    runner = asyncio.create_task(orchestrator.run(session, conn))
    await wait_for_sent(conn, "request_observation")
    await deliver_observation(conn)
    request_payload = await wait_for_sent(conn, "action_request")

    failed = ActionResultModel(
        action_id=request_payload.action.action_id,
        document_id="doc-1",
        mutation_epoch_before=7,
        mutation_epoch_after=8,
        ok=False,
        summary="The target changed after it was observed.",
        error={"code": "STALE_TARGET", "message": "stale", "retryable": True},
    )
    await conn.events.put(
        IncomingEvent(type="action_result", payload=ActionResultClientPayload(result=failed))
    )

    # The stale failure produced a stale_target re-observation request.
    requests = await wait_for_sent_all(conn, "request_observation", 2)
    assert [r.reason for r in requests] == ["initial", "stale_target"]
    await deliver_observation(conn)
    completed = await wait_for_sent(conn, "task_completed")
    assert isinstance(completed, TaskCompletedPayload)  # exhausted script finishes
    await runner


@pytest.mark.asyncio
async def test_repeated_identical_failure_stops() -> None:
    orchestrator = Orchestrator(
        provider=ScriptedProvider(
            [
                ActionDecision(tool="click_element", args={"element_id": 5}),
                ActionDecision(tool="click_element", args={"element_id": 5}),
            ]
        ),
        policy=PolicyEngine(),
    )
    conn = FakeConn()
    session = start_session()
    runner = asyncio.create_task(orchestrator.run(session, conn))
    await wait_for_sent_all(conn, "request_observation", 1)
    await deliver_observation(conn)

    for attempt in range(2):
        action_requests = await wait_for_sent_all(conn, "action_request", attempt + 1)
        last_action = action_requests[-1]
        failed = ActionResultModel(
            action_id=last_action.action.action_id,
            document_id="doc-1",
            mutation_epoch_before=7,
            mutation_epoch_after=7,
            ok=False,
            summary="nope",
            error={"code": "ACTION_FAILED", "message": "page ignored the click"},
        )
        await conn.events.put(
            IncomingEvent(type="action_result", payload=ActionResultClientPayload(result=failed))
        )
        if attempt == 0:
            await wait_for_sent_all(conn, "request_observation", 2)
            await deliver_observation(conn)

    failed_frame = await wait_for_sent(conn, "task_failed")
    assert failed_frame.code == "LOCAL_ACTION_ERROR"
    await runner


@pytest.mark.asyncio
async def test_step_limit_reached() -> None:
    orchestrator = Orchestrator(
        provider=ScriptedProvider([]),  # finishes immediately each time
        policy=PolicyEngine(),
        max_steps=0,
    )
    conn = FakeConn()
    session = start_session()
    runner = asyncio.create_task(orchestrator.run(session, conn))
    await wait_for_sent(conn, "request_observation")
    await deliver_observation(conn)

    failed = await wait_for_sent(conn, "task_failed")
    assert failed.code == "STEP_LIMIT_REACHED"
    await runner


@pytest.mark.asyncio
async def test_cancellation_suppresses_late_results() -> None:
    orchestrator = Orchestrator(
        provider=ScriptedProvider([ActionDecision(tool="click_element", args={"element_id": 5})]),
        policy=PolicyEngine(),
    )
    conn = FakeConn()
    session = start_session()
    runner = asyncio.create_task(orchestrator.run(session, conn))
    await wait_for_sent(conn, "request_observation")
    await deliver_observation(conn)
    request_payload = await wait_for_sent(conn, "action_request")

    await conn.events.put(IncomingEvent(type="cancel_task"))
    canceled = await wait_for_sent(conn, "task_failed")
    assert canceled.code == "CANCELED"
    assert session.status.value == "CANCELED"

    # A late action result must not resurrect the task.
    late = ActionResultModel(
        action_id=request_payload.action.action_id,
        document_id="doc-1",
        mutation_epoch_before=7,
        mutation_epoch_after=8,
        ok=True,
        summary="late click landed",
    )
    await conn.events.put(
        IncomingEvent(type="action_result", payload=ActionResultClientPayload(result=late))
    )
    await asyncio.sleep(0.05)
    assert session.status.value == "CANCELED"
    after_cancel_types = [t for t, _ in conn.sent[conn.sent.index(("task_failed", canceled)) :]]
    assert "request_observation" not in after_cancel_types
    await runner


@pytest.mark.asyncio
async def test_invalid_decision_repairs_once_then_fails() -> None:
    class AlwaysInvalidProvider:
        calls = 0

        async def decide(self, request: AgentDecisionRequest) -> AgentDecision:
            type(self).calls += 1
            return ActionDecision(tool="run_arbitrary_js", args={"code": "alert(1)"})

    provider = AlwaysInvalidProvider()
    orchestrator = Orchestrator(provider=provider, policy=PolicyEngine(), model_timeout_seconds=1)
    conn = FakeConn()
    session = start_session()
    runner = asyncio.create_task(orchestrator.run(session, conn))
    await wait_for_sent(conn, "request_observation")
    await deliver_observation(conn)

    failed = await wait_for_sent(conn, "task_failed")
    assert failed.code == "MODEL_PROTOCOL_ERROR"
    assert provider.calls == 2  # exactly one repair retry
    await runner


@pytest.mark.asyncio
async def test_provider_timeout_fails_task() -> None:
    class SlowProvider:
        async def decide(self, request: AgentDecisionRequest) -> AgentDecision:
            await asyncio.sleep(5)
            raise AssertionError("should have been cancelled")

    orchestrator = Orchestrator(
        provider=SlowProvider(), policy=PolicyEngine(), model_timeout_seconds=0.05
    )
    conn = FakeConn()
    session = start_session()
    runner = asyncio.create_task(orchestrator.run(session, conn))
    await wait_for_sent(conn, "request_observation")
    await deliver_observation(conn)

    failed = await wait_for_sent(conn, "task_failed")
    assert failed.code == "MODEL_TIMEOUT"
    await runner


@pytest.mark.asyncio
async def test_disconnect_is_a_safe_stop() -> None:
    orchestrator = Orchestrator(
        provider=ScriptedProvider([ActionDecision(tool="click_element", args={"element_id": 5})]),
        policy=PolicyEngine(),
    )
    conn = FakeConn()
    session = start_session()
    runner = asyncio.create_task(orchestrator.run(session, conn))
    await wait_for_sent(conn, "request_observation")
    await conn.events.put(None)  # disconnect sentinel

    await asyncio.wait_for(runner, timeout=1)
    assert session.status.value == "FAILED"
    assert session.terminal_reason == "disconnected"
    # Nothing was sent after the disconnect.
    assert conn.sent[-1][0] == "request_observation"
