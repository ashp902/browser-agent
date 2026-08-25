"""Task orchestrator (docs/04).

Deterministic control loop around a decider (mock now, LLM adapter later):
observe -> decide ONE action -> schema/policy validation -> gate ->
execute -> re-observe -> continue until finish, limits, cancellation, or
disconnect. The orchestrator owns sequencing and safety; the decider only
proposes. Consequential actions require bound user confirmation; sensitive
steps pause for manual completion (docs/04 §18-§19, docs/06 §7-§9).
"""

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Protocol
from uuid import uuid4

from app.agent.confirmations import (
    build_token,
    create_confirmation,
    summary_for,
)
from app.agent.tool_catalog import ValidatedAction, validate_action_decision
from app.policy.engine import PolicyContext, PolicyEngine, PolicyResult, nearby_text_for
from app.protocols.actions import BrowserActionRequest
from app.protocols.events import (
    ActionRequestPayload,
    ActionResultClientPayload,
    ConfirmationRequestPayload,
    ManualActionRequestPayload,
    ObservationPayload,
    RequestObservationPayload,
    TaskCompletedPayload,
    TaskCreatedPayload,
    TaskFailedPayload,
)
from app.protocols.observations import ObservationSnapshot
from app.providers.base import (
    ActionDecision,
    AgentDecisionRequest,
    DecisionValidationError,
    FinishDecision,
    LLMProvider,
    ProviderTimeoutError,
)
from app.sessions.models import (
    AgentSession,
    PendingAction,
    PendingConfirmation,
    StepRecord,
    TaskStatus,
    transition,
)
from app.telemetry.logging import log_event
from app.telemetry.tracing import build_trace, semantic_hash

ActionDecisionLike = ActionDecision

logger = logging.getLogger(__name__)

# docs/03 §19 default stabilization delay before requesting the next
# observation after a state-changing action.
STABILIZATION_DELAY_S = 0.25

# Failures meaning "the page moved on": re-observe and let the decider choose
# again instead of retrying blindly (docs/04 §14).
REOBSERVE_ON_FAILURE = {"STALE_TARGET", "TARGET_NOT_FOUND", "DOCUMENT_CHANGED"}

DISCONNECT_EVENT = "__disconnect__"


class ConnectionClosedError(Exception):
    """Peer went away or stopped responding; safe-stop the task."""


@dataclass(slots=True)
class IncomingEvent:
    type: str
    payload: object | None = None


class ServerEventSink(Protocol):
    async def send_server_event(self, type_: str, payload: object) -> None: ...


class TaskConnection(ServerEventSink, Protocol):
    async def next_event(self) -> IncomingEvent: ...


class ModelProtocolError(Exception):
    def __init__(self, violations: list[str]) -> None:
        super().__init__("; ".join(violations))
        self.violations = violations


class Orchestrator:
    def __init__(
        self,
        provider: LLMProvider,
        policy: PolicyEngine,
        max_steps: int = 25,
        model_timeout_seconds: float = 30.0,
        confirmation_timeout_seconds: float = 120.0,
    ) -> None:
        self.provider = provider
        self.policy = policy
        self.max_steps = max_steps
        self.model_timeout_seconds = model_timeout_seconds
        self.confirmation_timeout_seconds = confirmation_timeout_seconds

    # -- entry --------------------------------------------------------------

    async def run(self, session: AgentSession, conn: TaskConnection) -> AgentSession:
        try:
            await conn.send_server_event(
                "task_created",
                TaskCreatedPayload(task_id=str(session.task_id), status=session.status.value),
            )
            transition(session, TaskStatus.WAITING_OBSERVATION)
            await self._request_observation(conn, "initial")

            while not session.is_terminal:
                event = await conn.next_event()
                await self._handle(session, conn, event)
        except ConnectionClosedError:
            # Safe stop on disconnect/idle: no further sends (docs/05 §13).
            if not session.is_terminal:
                transition(session, TaskStatus.FAILED)
                session.terminal_reason = "disconnected"
        return session

    async def _handle(
        self, session: AgentSession, conn: TaskConnection, event: IncomingEvent
    ) -> None:
        if event.type == DISCONNECT_EVENT:
            if not session.is_terminal:
                transition(session, TaskStatus.FAILED)
                session.terminal_reason = "disconnected"
            return

        if event.type == "cancel_task":
            session.canceled = True
            await self._fail(session, conn, code="CANCELED", message="Task canceled by the user.")
            return

        if event.type == "client_error":
            log_event(
                logger,
                logging.WARNING,
                "client reported a local error",
                task_id=str(session.task_id),
            )
            return

        if event.type == "observation":
            assert isinstance(event.payload, ObservationPayload)
            await self._on_observation(session, conn, event.payload.snapshot)
            return

        if event.type == "action_result":
            assert isinstance(event.payload, ActionResultClientPayload)
            await self._on_action_result(session, conn, event.payload.result)
            return

        # Stray confirmation/manual events outside their gated phases are ignored.
        log_event(logger, logging.DEBUG, "ignoring event without handler", type=event.type)

    # -- observe / decide ---------------------------------------------------

    async def _on_observation(
        self, session: AgentSession, conn: TaskConnection, snapshot: ObservationSnapshot
    ) -> None:
        transition(session, TaskStatus.THINKING)
        session.latest_snapshot = snapshot
        session.step_count += 1
        if session.step_count > self.max_steps:
            await self._fail(
                session,
                conn,
                code="STEP_LIMIT_REACHED",
                message=f"Reached the limit of {self.max_steps} steps.",
            )
            return
        session.history.append(
            StepRecord(step=session.step_count, snapshot_id=snapshot.snapshot_id)
        )
        await self._think(session, conn)

    async def _think(self, session: AgentSession, conn: TaskConnection) -> None:
        """One decision cycle against the latest observation."""
        snapshot = session.latest_snapshot
        if snapshot is None:
            await self._fail(
                session, conn, code="INTERNAL_SERVER_ERROR", message="No observation held."
            )
            return

        request = AgentDecisionRequest(
            goal=session.user_goal,
            observation=snapshot,
            history=list(session.history),
        )
        try:
            decision = await self._decide_with_repair(request)
        except ModelProtocolError as error:
            await self._fail(session, conn, code="MODEL_PROTOCOL_ERROR", message=str(error))
            return
        except ProviderTimeoutError:
            await self._fail(
                session, conn, code="MODEL_TIMEOUT", message="The decider did not respond in time."
            )
            return

        if isinstance(decision, FinishDecision):
            # Finish requires evidence: an observation must exist and nothing
            # may be pending (docs/04 §17).
            if session.pending_action is not None or session.pending_confirmation is not None:
                await self._fail(
                    session,
                    conn,
                    code="MODEL_PROTOCOL_ERROR",
                    message="Finish proposed while an action was still pending.",
                )
                return
            transition(session, TaskStatus.COMPLETED)
            session.terminal_reason = "finish"
            await conn.send_server_event(
                "task_completed",
                TaskCompletedPayload(
                    task_id=str(session.task_id),
                    summary=decision.summary,
                    metrics={"steps": session.step_count},
                    trace=build_trace(session),
                ),
            )
            return

        validated = validate_action_decision(decision, snapshot)
        context = PolicyContext(
            url=snapshot.url,
            nearby_text=nearby_text_for(snapshot.semantic_text, _element_id(validated)),
        )
        policy_decision = self.policy.evaluate(validated, context)

        if policy_decision.result == PolicyResult.DENY:
            # Record the refusal so traces distinguish reasoning/policy blocks
            # (docs/08 §13) instead of silently swallowing the proposal.
            session.history.append(
                StepRecord(
                    step=session.step_count,
                    snapshot_id=snapshot.snapshot_id,
                    action={"tool": decision.tool, "args": decision.args},
                    policy=PolicyResult.DENY,
                    result_summary="Refused by policy.",
                    error_code="POLICY_DENIED",
                )
            )
            log_event(
                logger,
                logging.WARNING,
                "action denied by policy",
                task_id=str(session.task_id),
                tool=decision.tool,
            )
            await self._fail(
                session,
                conn,
                code="POLICY_DENIED",
                message=f"Action refused by policy: {policy_decision.reason}",
            )
            return

        if policy_decision.result == PolicyResult.REQUIRE_MANUAL_USER_ACTION:
            await self._manual_gate(session, conn, validated, policy_decision.reason, snapshot)
            return

        if policy_decision.result == PolicyResult.REQUIRE_CONFIRMATION:
            await self._confirmation_gate(session, conn, validated, decision, snapshot)
            return

        await self._send_action(session, conn, validated, decision, snapshot, policy="ALLOW")

    # -- gates ----------------------------------------------------------------

    async def _manual_gate(
        self,
        session: AgentSession,
        conn: TaskConnection,
        validated: ValidatedAction,
        reason: str,
        snapshot: ObservationSnapshot,
    ) -> None:
        transition(session, TaskStatus.WAITING_MANUAL_ACTION)
        input_type = validated.expected_target.input_type if validated.expected_target else None
        code = "PASSWORD_REQUIRED" if input_type == "password" else "SENSITIVE_FIELD"
        name = (
            validated.expected_target.normalized_name if validated.expected_target else "the field"
        )
        instruction = (
            f"Enter '{name}' directly on the webpage yourself, then press Resume."
            " Never send secrets through this chat."
        )
        log_event(logger, logging.INFO, "manual gate engaged", kind=code)
        await conn.send_server_event(
            "manual_action_request",
            ManualActionRequestPayload(reason=code, instruction=instruction),
        )

        while not session.is_terminal:
            event = await conn.next_event()
            if event.type == DISCONNECT_EVENT:
                if not session.is_terminal:
                    transition(session, TaskStatus.FAILED)
                    session.terminal_reason = "disconnected"
                return
            if event.type == "cancel_task":
                session.canceled = True
                await self._fail(
                    session, conn, code="CANCELED", message="Task canceled by the user."
                )
                return
            if event.type == "manual_action_completed":
                # Fresh observation before continuing (docs/04 §19).
                transition(session, TaskStatus.WAITING_OBSERVATION)
                await asyncio.sleep(STABILIZATION_DELAY_S)
                await self._request_observation(conn, "manual_resume")
                return
            if event.type == "observation":
                # Page moved during the manual pause; adopt the new state but
                # stay paused - the user has not resumed yet.
                assert isinstance(event.payload, ObservationPayload)
                session.latest_snapshot = event.payload.snapshot
                continue
            log_event(logger, logging.DEBUG, "ignoring event during manual gate", type=event.type)

    async def _confirmation_gate(
        self,
        session: AgentSession,
        conn: TaskConnection,
        validated: ValidatedAction,
        decision: ActionDecisionLike,
        snapshot: ObservationSnapshot,
    ) -> None:
        frozen = self._build_request(decision, snapshot, validated)
        confirmation = create_confirmation(
            session.task_id,
            frozen,
            ttl_seconds=self.confirmation_timeout_seconds,
        )
        expires_at_ms = int(confirmation.expires_at.timestamp() * 1000)
        session.pending_confirmation = PendingConfirmation(
            request=frozen,
            policy=PolicyResult.REQUIRE_CONFIRMATION,
            confirmation_id=str(confirmation.confirmation_id),
            expires_at_ms=expires_at_ms,
        )
        transition(session, TaskStatus.WAITING_CONFIRMATION)
        await conn.send_server_event(
            "confirmation_request",
            ConfirmationRequestPayload(
                confirmation_id=str(confirmation.confirmation_id),
                action_id=frozen.action_id,
                title="Confirm action",
                summary=summary_for(frozen),
                risk="consequential",
                expires_at_ms=expires_at_ms,
            ),
        )

        deadline = asyncio.get_running_loop().time() + self.confirmation_timeout_seconds
        while not session.is_terminal:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                await self._fail(
                    session,
                    conn,
                    code="CONFIRMATION_EXPIRED",
                    message="The confirmation window expired.",
                )
                return
            try:
                event = await asyncio.wait_for(conn.next_event(), timeout=remaining)
            except TimeoutError as error:
                await self._fail(
                    session,
                    conn,
                    code="CONFIRMATION_EXPIRED",
                    message="The confirmation window expired.",
                )
                raise ConnectionClosedError() from error

            if event.type == DISCONNECT_EVENT:
                if not session.is_terminal:
                    transition(session, TaskStatus.FAILED)
                    session.terminal_reason = "disconnected"
                return
            if event.type == "cancel_task":
                session.canceled = True
                await self._fail(
                    session, conn, code="CANCELED", message="Task canceled by the user."
                )
                return

            if event.type == "confirmation_response":
                from pydantic import BaseModel

                assert isinstance(event.payload, BaseModel)
                response_id = event.payload.confirmation_id
                user_decision = event.payload.decision
                if response_id != str(confirmation.confirmation_id):
                    log_event(logger, logging.WARNING, "ignoring mismatched confirmation response")
                    continue
                session.pending_confirmation = None

                if user_decision == "deny":
                    # The denied action never executes; record and let the
                    # decider choose a different route (docs/04 §18 step 7).
                    session.history.append(
                        StepRecord(
                            step=session.step_count,
                            snapshot_id=snapshot.snapshot_id,
                            action={"tool": frozen.tool, "args": frozen.args},
                            policy=PolicyResult.REQUIRE_CONFIRMATION,
                            result_summary="User denied the action.",
                            error_code="USER_DENIED_ACTION",
                        )
                    )
                    transition(session, TaskStatus.THINKING)
                    await self._think(session, conn)
                    return

                # Approve: execute the FROZEN action with its bound token,
                # asking the decider nothing further (docs/04 §18 step 5).
                # The token rides inside the action so every hop (panel ->
                # worker -> executor) can verify the binding (docs/03 §20).
                frozen.confirmation_token = build_token(confirmation, frozen)
                signature = (
                    f"{semantic_hash(snapshot.semantic_text)}:{frozen.tool}:"
                    f"{json.dumps(frozen.args, sort_keys=True)}"
                )
                session.pending_action = PendingAction(
                    request=frozen,
                    policy=PolicyResult.REQUIRE_CONFIRMATION,
                    signature=signature,
                )
                transition(session, TaskStatus.WAITING_ACTION_RESULT)
                await conn.send_server_event(
                    "action_request",
                    ActionRequestPayload(
                        action=frozen,
                        policy=PolicyResult.REQUIRE_CONFIRMATION,
                    ),
                )
                return

            if event.type == "observation":
                # Page changed while waiting: approval would be stale. Drop the
                # frozen action, re-observe/reason (docs/04 §18 step 6).
                assert isinstance(event.payload, ObservationPayload)
                session.latest_snapshot = event.payload.snapshot
                session.pending_confirmation = None
                transition(session, TaskStatus.WAITING_OBSERVATION)
                await self._request_observation(conn, "after_action")
                return

            log_event(
                logger, logging.DEBUG, "ignoring event during confirmation gate", type=event.type
            )

    # -- execution ----------------------------------------------------------

    async def _send_action(
        self,
        session: AgentSession,
        conn: TaskConnection,
        validated: ValidatedAction,
        decision: ActionDecisionLike,
        snapshot: ObservationSnapshot,
        policy: str,
    ) -> None:
        request = self._build_request(decision, snapshot, validated)
        signature = (
            f"{semantic_hash(snapshot.semantic_text)}:{request.tool}:"
            f"{json.dumps(request.args, sort_keys=True)}"
        )
        session.pending_action = PendingAction(request=request, policy=policy, signature=signature)
        transition(session, TaskStatus.WAITING_ACTION_RESULT)
        await conn.send_server_event(
            "action_request", ActionRequestPayload(action=request, policy=policy)
        )

    def _build_request(
        self,
        decision: ActionDecisionLike,
        snapshot: ObservationSnapshot,
        validated: ValidatedAction,
    ) -> BrowserActionRequest:
        return BrowserActionRequest(
            action_id=str(uuid4()),
            document_id=snapshot.document_id,
            observed_mutation_epoch=snapshot.mutation_epoch,
            tool=decision.tool,
            args=decision.args,
            expected_target=validated.expected_target,
        )

    async def _on_action_result(self, session: AgentSession, conn: TaskConnection, result) -> None:
        pending = session.pending_action
        if pending is None or session.status != TaskStatus.WAITING_ACTION_RESULT:
            # Late/duplicate results for an already-handled action are ignored.
            log_event(logger, logging.WARNING, "ignoring unexpected action result")
            return
        if result.action_id != pending.request.action_id:
            log_event(logger, logging.WARNING, "ignoring mismatched action id on action_result")
            return

        session.pending_action = None
        record = session.history[-1] if session.history else StepRecord(step=session.step_count)
        record.action = {"tool": pending.request.tool, "args": pending.request.args}
        record.policy = pending.policy
        record.result_summary = result.summary
        record.signature = pending.signature
        if not result.ok and result.error is not None:
            record.error_code = result.error.code

        transition(session, TaskStatus.WAITING_OBSERVATION)

        reason = "after_action"
        if not result.ok and result.error is not None:
            if record.error_code in REOBSERVE_ON_FAILURE:
                reason = "stale_target"
            # docs/04 §15: three occurrences of an identical unsuccessful
            # signature, or a repeating A/B pair, mean the loop is stuck.
            if _loop_detected(session.history):
                await self._fail(
                    session,
                    conn,
                    code="AGENT_LOOP_DETECTED",
                    message="The same unsuccessful actions kept repeating; stopping.",
                )
                return
            # docs/04 §14: the same failing action never auto-retries twice.
            if _is_repeated_failure(session.history, pending.signature):
                await self._fail(
                    session,
                    conn,
                    code="LOCAL_ACTION_ERROR",
                    message="The same action kept failing; stopping instead of retrying blindly.",
                )
                return

        await asyncio.sleep(STABILIZATION_DELAY_S)
        await self._request_observation(conn, reason)

    # -- helpers --------------------------------------------------------------

    async def _decide_with_repair(self, request: AgentDecisionRequest):
        # One repair retry with an explicit schema error; a second invalid
        # response fails the task (docs/04 §8).
        violations: list[str] = []
        for attempt in range(2):
            try:
                decision = await asyncio.wait_for(
                    self.provider.decide(request), timeout=self.model_timeout_seconds
                )
            except TimeoutError as error:
                raise ProviderTimeoutError() from error
            if isinstance(decision, FinishDecision):
                return decision
            try:
                validate_action_decision(decision, request.observation)
                return decision
            except DecisionValidationError as error:
                violations = error.violations
                log_event(
                    logger,
                    logging.WARNING,
                    "invalid model decision; repairing once",
                    attempt=attempt,
                )
        raise ModelProtocolError(violations)

    async def _request_observation(self, conn: TaskConnection, reason: str) -> None:
        await conn.send_server_event(
            "request_observation", RequestObservationPayload(reason=reason)
        )  # type: ignore[arg-type]

    async def _fail(
        self, session: AgentSession, conn: TaskConnection, code: str, message: str
    ) -> None:
        if session.canceled:
            transition(session, TaskStatus.CANCELED)
        else:
            transition(session, TaskStatus.FAILED)
        session.terminal_reason = code
        try:
            await conn.send_server_event(
                "task_failed",
                TaskFailedPayload(
                    task_id=str(session.task_id),
                    code=code,
                    message=message,
                    trace=build_trace(session),
                ),
            )
        except ConnectionClosedError:
            pass


def _element_id(validated: ValidatedAction) -> int | None:
    element_id = validated.args.get("element_id")
    return element_id if isinstance(element_id, int) else None


def _is_repeated_failure(history: list[StepRecord], signature: str | None) -> bool:
    if signature is None:
        return False
    failing = [record for record in history if record.error_code is not None]
    if len(failing) < 2:
        return False
    last_two = failing[-2:]
    signatures = [record.signature or "" for record in last_two]
    return signatures[0] == signature and signatures[1] == signature


def _loop_detected(history: list[StepRecord]) -> bool:
    """docs/04 §15: 3 identical unsuccessful signatures, or an alternating
    A/B pair repeated through 3 cycles, indicate a stuck loop."""
    failing = [record for record in history if record.error_code is not None]
    signatures = [
        record.signature or f"{(record.action or {}).get('tool')}:{record.error_code}"
        for record in failing
    ]

    counts: dict[str, int] = {}
    for signature in signatures:
        counts[signature] = counts.get(signature, 0) + 1
        if counts[signature] >= 3:
            return True

    if len(signatures) >= 6:
        a, b = signatures[-1], signatures[-2]
        if a != b and signatures[-6:] == [a, b, a, b, a, b]:
            return True
    return False
