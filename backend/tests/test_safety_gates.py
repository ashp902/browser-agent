"""Safety-gate flow tests: confirmation, denial, expiry, manual steps
(docs/09 Milestone 6 acceptance)."""

import asyncio
import base64
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
    ConfirmationRequestPayload,
    ObservationPayload,
)
from app.protocols.observations import ObservationSnapshot, SnapshotStats
from app.providers.base import (
    ActionDecision,
    AgentDecision,
    AgentDecisionRequest,
    FinishDecision,
)
from app.sessions.models import AgentSession


def snapshot_with(
    element_id: int,
    name: str,
    role: str = "button",
    input_type: str | None = None,
    epoch: int = 3,
) -> ObservationSnapshot:
    fingerprint = {"role": role, "normalized_name": name, "tag_name": role}
    if input_type is not None:
        fingerprint["input_type"] = input_type
    return ObservationSnapshot(
        document_id="doc-1",
        snapshot_id=f"snap-{uuid4()}",
        mutation_epoch=epoch,
        url="https://shop.example/checkout",
        origin="https://shop.example",
        title="Checkout",
        semantic_text=(
            f'PAGE title="Checkout" url="https://shop.example/checkout"'
            f' snapshot="x" epoch={epoch}\n'
            f'  BUTTON @{element_id} "{name}"'
        ),
        actionable_fingerprints={str(element_id): fingerprint},
        stats=SnapshotStats(
            node_count=2,
            actionable_count=1,
            truncated_nodes=0,
            snapshot_truncated=False,
            serialized_chars=60,
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
    async def poll() -> object:
        while True:
            for name, payload in conn.sent:
                if name == type_:
                    return payload
            await asyncio.sleep(0.005)

    return await asyncio.wait_for(poll(), budget)


def ok_result(request_payload: ActionRequestPayload) -> ActionResultClientPayload:
    return ActionResultClientPayload(
        result=ActionResultModel(
            action_id=request_payload.action.action_id,
            document_id=request_payload.action.document_id,
            mutation_epoch_before=request_payload.action.observed_mutation_epoch,
            mutation_epoch_after=request_payload.action.observed_mutation_epoch + 1,
            ok=True,
            changed=True,
            summary="done",
        )
    )


async def deliver_observation(conn: FakeConn, snapshot: ObservationSnapshot) -> None:
    await conn.events.put(
        IncomingEvent(type="observation", payload=ObservationPayload(snapshot=snapshot))
    )


from app.agent.orchestrator import IncomingEvent  # noqa: E402


def start(max_steps: int = 25) -> AgentSession:
    return AgentSession(task_id=uuid4(), user_goal="Place an order", max_steps=max_steps)


@pytest.mark.asyncio
async def test_consequential_action_requires_confirmation_then_executes() -> None:
    orchestrator = Orchestrator(
        provider=ScriptedProvider(
            [
                ActionDecision(tool="click_element", args={"element_id": 9}),
                FinishDecision(summary="Order placed."),
            ]
        ),
        policy=PolicyEngine(),
    )
    conn = FakeConn()
    session = start()
    runner = asyncio.create_task(orchestrator.run(session, conn))

    await wait_for_sent(conn, "request_observation")
    await deliver_observation(conn, snapshot_with(9, "place order"))

    confirmation = await wait_for_sent(conn, "confirmation_request")
    assert isinstance(confirmation, ConfirmationRequestPayload)
    assert confirmation.risk == "consequential"
    assert session.status.value == "WAITING_CONFIRMATION"

    # Approve: the frozen action executes with a bound token.
    await conn.events.put(
        IncomingEvent(
            type="confirmation_response",
            payload=_response(confirmation.confirmation_id, "approve"),
        )
    )
    action_request = await wait_for_sent(conn, "action_request")
    assert action_request.policy == "REQUIRE_CONFIRMATION"
    token = action_request.action.confirmation_token
    assert token is not None
    fields = json.loads(base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)))
    assert fields["action_id"] == action_request.action.action_id

    await conn.events.put(IncomingEvent(type="action_result", payload=ok_result(action_request)))
    await wait_for_sent_all(conn, "request_observation", 2)
    await deliver_observation(conn, snapshot_with(9, "place order"))
    completed = await wait_for_sent(conn, "task_completed")

    # The executed click is recorded as the confirmed consequential action.
    executed_step = completed.trace["steps"][0]
    assert executed_step["policy"] == "REQUIRE_CONFIRMATION"
    assert executed_step["action"]["tool"] == "click_element"
    assert "confirmation_token" not in json.dumps(completed.trace)  # tokens never leak into traces
    await runner


def _response(confirmation_id: str, decision: str):
    from pydantic import BaseModel

    class Response(BaseModel):
        confirmation_id: str
        decision: str

    return Response(confirmation_id=confirmation_id, decision=decision)


async def wait_for_sent_all(conn: FakeConn, type_: str, count: int, budget: float = 2.0):
    async def poll() -> list:
        while True:
            matches = [payload for name, payload in conn.sent if name == type_]
            if len(matches) >= count:
                return matches
            await asyncio.sleep(0.005)

    return await asyncio.wait_for(poll(), budget)


@pytest.mark.asyncio
async def test_user_denial_prevents_action_and_model_redecides() -> None:
    orchestrator = Orchestrator(
        provider=ScriptedProvider(
            [
                ActionDecision(tool="click_element", args={"element_id": 9}),
                FinishDecision(summary="Stopped without ordering."),
            ]
        ),
        policy=PolicyEngine(),
    )
    conn = FakeConn()
    session = start()
    runner = asyncio.create_task(orchestrator.run(session, conn))
    await wait_for_sent(conn, "request_observation")
    await deliver_observation(conn, snapshot_with(9, "place order"))
    confirmation = await wait_for_sent(conn, "confirmation_request")

    await conn.events.put(
        IncomingEvent(
            type="confirmation_response", payload=_response(confirmation.confirmation_id, "deny")
        )
    )

    completed = await wait_for_sent(conn, "task_completed")
    # Denial prevented execution: no action_request was ever emitted.
    assert all(t != "action_request" for t, _ in conn.sent)
    denied_records = [r for r in session.history if r.error_code == "USER_DENIED_ACTION"]
    assert len(denied_records) == 1
    assert "without ordering" in completed.summary
    await runner


@pytest.mark.asyncio
async def test_confirmation_expiry_fails_task() -> None:
    orchestrator = Orchestrator(
        provider=ScriptedProvider([ActionDecision(tool="click_element", args={"element_id": 9})]),
        policy=PolicyEngine(),
        confirmation_timeout_seconds=0.1,
    )
    conn = FakeConn()
    session = start()
    runner = asyncio.create_task(orchestrator.run(session, conn))
    await wait_for_sent(conn, "request_observation")
    await deliver_observation(conn, snapshot_with(9, "place order"))
    await wait_for_sent(conn, "confirmation_request")

    failed = await wait_for_sent(conn, "task_failed", budget=2.0)
    assert failed.code == "CONFIRMATION_EXPIRED"
    await runner


@pytest.mark.asyncio
async def test_password_field_goes_manual_and_secret_never_dispatched() -> None:
    orchestrator = Orchestrator(
        provider=ScriptedProvider(
            [
                ActionDecision(tool="set_text", args={"element_id": 4, "text": "hunter2-secret"}),
                FinishDecision(summary="Paused for manual password entry."),
            ]
        ),
        policy=PolicyEngine(),
    )
    conn = FakeConn()
    session = start()
    runner = asyncio.create_task(orchestrator.run(session, conn))
    await wait_for_sent(conn, "request_observation")
    await deliver_observation(
        conn, snapshot_with(4, "password", role="textbox", input_type="password")
    )

    manual = await wait_for_sent(conn, "manual_action_request")
    assert manual.reason == "PASSWORD_REQUIRED"
    assert session.status.value == "WAITING_MANUAL_ACTION"
    # Critical: the secret never leaves the backend as an action request.
    assert all(t != "action_request" for t, _ in conn.sent)

    await conn.events.put(IncomingEvent(type="manual_action_completed"))
    reobserve = await wait_for_sent_all(conn, "request_observation", 2)
    assert reobserve[-1].reason == "manual_resume"
    await deliver_observation(
        conn, snapshot_with(4, "password", role="textbox", input_type="password")
    )
    completed = await wait_for_sent(conn, "task_completed")
    assert "manual" in completed.summary or "Paused" in completed.summary
    await runner


@pytest.mark.asyncio
async def test_policy_denied_navigation_fails_task() -> None:
    orchestrator = Orchestrator(
        provider=ScriptedProvider(
            [ActionDecision(tool="navigate_current_tab", args={"url": "javascript:alert(1)"})]
        ),
        policy=PolicyEngine(),
    )
    conn = FakeConn()
    session = start()
    runner = asyncio.create_task(orchestrator.run(session, conn))
    await wait_for_sent(conn, "request_observation")
    await deliver_observation(conn, snapshot_with(9, "evil link", role="link"))

    failed = await wait_for_sent(conn, "task_failed")
    assert failed.code == "POLICY_DENIED"
    assert all(t != "action_request" for t, _ in conn.sent)
    await runner
