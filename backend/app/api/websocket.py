"""Agent WebSocket endpoint (docs/05 §5).

One connection hosts one active task for MVP. The endpoint validates every
frame's envelope and payload, routes task events into the orchestrator's
connection bridge, and enforces origin rules. Authentication is isolated here
so production identity can be added without changing event schemas
(docs/05 §4, OPEN-001).
"""

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.agent.orchestrator import (
    DISCONNECT_EVENT,
    ConnectionClosedError,
    IncomingEvent,
    Orchestrator,
)
from app.protocols.events import (
    InvalidEventError,
    ProtocolVersionError,
    parse_envelope,
    validate_client_payload,
)
from app.sessions.models import AgentSession
from app.telemetry.logging import log_event

logger = logging.getLogger(__name__)

router = APIRouter()

# Close code used for explicit protocol rejections.
CLOSE_POLICY_VIOLATION = 1008


@dataclass(slots=True)
class WsTaskConnection:
    """Bridges the WebSocket transport and the orchestrator."""

    websocket: WebSocket
    idle_timeout_seconds: float = 600.0
    inbox: asyncio.Queue[IncomingEvent] = field(default_factory=asyncio.Queue)
    session: AgentSession | None = None
    closed: bool = False

    async def send_server_event(self, type_: str, payload: object) -> None:
        if self.closed or self.websocket.client_state.name != "CONNECTED":
            raise ConnectionClosedError()
        envelope = {
            "protocol_version": 1,
            "event_id": str(uuid4()),
            "task_id": str(self.session.task_id) if self.session else None,
            "type": type_,
            "timestamp_ms": 0,
            "payload": _model_dump(payload),
        }
        await self.websocket.send_text(json.dumps(envelope))

    async def next_event(self) -> IncomingEvent:
        try:
            return await asyncio.wait_for(self.inbox.get(), timeout=self.idle_timeout_seconds)
        except TimeoutError as error:
            self.closed = True
            raise ConnectionClosedError() from error


def _model_dump(payload: object) -> dict[str, Any]:
    dump = getattr(payload, "model_dump", None)
    if callable(dump):
        return dump()
    if isinstance(payload, dict):
        return payload
    return {}


async def _send_frame(
    websocket: WebSocket, type_: str, task_id: str | None, payload: dict[str, Any]
) -> None:
    envelope = {
        "protocol_version": 1,
        "event_id": str(uuid4()),
        "task_id": task_id,
        "type": type_,
        "timestamp_ms": 0,
        "payload": payload,
    }
    await websocket.send_text(json.dumps(envelope))


async def _reject_and_close(websocket: WebSocket, code: str, message: str) -> None:
    await _send_frame(websocket, "task_failed", None, {"code": code, "message": message})
    await websocket.close(code=CLOSE_POLICY_VIOLATION)


async def _reject_payload(websocket: WebSocket, task_id: str | None, detail: str) -> None:
    # Known event type with an invalid payload: report and stay open so the
    # client can recover.
    await _send_frame(
        websocket,
        "task_failed",
        task_id,
        {"code": "INVALID_EVENT", "message": f"Invalid event payload: {detail}"},
    )


def _origin_allowed(origin: str | None, allowed_origins: list[str]) -> bool:
    if not origin:
        # Non-browser clients (tests, local tooling).
        return True
    if not allowed_origins:
        # Local development default: any extension origin; production must
        # configure an exact allowlist (docs/05 §17).
        return origin.startswith("chrome-extension://") or "localhost" in origin
    return origin in allowed_origins


@router.websocket("/v1/agent/ws")
async def agent_ws(websocket: WebSocket) -> None:
    runtime = websocket.app.state.runtime
    settings = runtime.settings

    if not _origin_allowed(websocket.headers.get("origin"), settings.allowed_origins_list()):
        await websocket.close(code=CLOSE_POLICY_VIOLATION)
        return
    await websocket.accept()

    conn = WsTaskConnection(
        websocket=websocket,
        idle_timeout_seconds=settings.task_idle_timeout_seconds,
    )
    orchestrator = Orchestrator(
        provider=runtime.provider_factory(),
        policy=runtime.policy,
        max_steps=settings.task_max_steps,
        model_timeout_seconds=settings.model_timeout_seconds,
        confirmation_timeout_seconds=settings.confirmation_timeout_seconds,
    )
    runner: asyncio.Task[AgentSession] | None = None

    try:
        while True:
            raw = await websocket.receive_text()

            try:
                envelope = parse_envelope(json.loads(raw))
            except ProtocolVersionError as error:
                log_event(logger, logging.WARNING, "protocol version rejected", detail=str(error))
                await _reject_and_close(websocket, "INVALID_PROTOCOL", str(error))
                return
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                log_event(logger, logging.WARNING, "malformed frame rejected", detail=str(error))
                await _reject_and_close(websocket, "INVALID_EVENT", "Malformed event frame.")
                return

            try:
                payload_model = validate_client_payload(envelope)
            except InvalidEventError as error:
                log_event(logger, logging.WARNING, "unknown event type rejected", detail=str(error))
                await _reject_and_close(websocket, "INVALID_EVENT", str(error))
                return
            except ValueError as error:
                await _reject_payload(websocket, envelope.task_id, str(error))
                continue

            if envelope.type == "start_task":
                if runner is not None and not runner.done():
                    await _reject_payload(websocket, envelope.task_id, "A task is already active.")
                    continue
                session = AgentSession(task_id=uuid4(), user_goal=payload_model.goal)  # type: ignore[attr-defined]
                session.max_steps = settings.task_max_steps
                conn.session = session
                conn.closed = False
                await runtime.store.create(session)
                runner = asyncio.create_task(orchestrator.run(session, conn))
                continue

            if runner is None or conn.session is None or conn.session.is_terminal:
                # Covers reconnect attempts against missing/expired tasks
                # (docs/05 §13): in-memory tasks vanish on restart.
                await _send_frame(
                    websocket,
                    "task_failed",
                    envelope.task_id,
                    {
                        "code": "TASK_NOT_FOUND",
                        "message": "No active task matches this connection.",
                    },
                )
                continue

            await conn.inbox.put(IncomingEvent(type=envelope.type, payload=payload_model))

    except WebSocketDisconnect:
        pass
    finally:
        # Disconnect produces a safe stop (docs/09 Milestone 4): the
        # orchestrator marks the task terminal and sends nothing further.
        await conn.inbox.put(IncomingEvent(type=DISCONNECT_EVENT))
        if runner is not None:
            try:
                await asyncio.wait_for(asyncio.shield(runner), timeout=5.0)
            except (TimeoutError, asyncio.CancelledError):
                runner.cancel()
