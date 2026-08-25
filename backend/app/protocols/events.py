"""Wire protocol event models (docs/05).

Every frame is an Envelope. Client payload models validate inbound events;
server payload models are serialized outbound. Unknown event types and invalid
payloads are rejected explicitly (INVALID_EVENT); unsupported protocol versions
are rejected explicitly (INVALID_PROTOCOL).
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.protocols.actions import ActionResultModel, BrowserActionRequest
from app.protocols.observations import ObservationSnapshot

PROTOCOL_VERSION = 1

ObservationReason = Literal[
    "initial", "after_action", "stale_target", "manual_resume", "final_verification"
]


class ProtocolVersionError(ValueError):
    pass


class InvalidEventError(ValueError):
    pass


class Envelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    protocol_version: int
    event_id: str = Field(min_length=1)
    task_id: str | None = None
    type: str = Field(min_length=1)
    timestamp_ms: int = Field(ge=0)
    payload: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Client -> server payloads (docs/05 §6)
# ---------------------------------------------------------------------------


class ClientInfo(BaseModel):
    extension_version: str = ""
    locale: str = ""


class StartTaskPayload(BaseModel):
    goal: str = Field(min_length=1, max_length=4000)
    client: ClientInfo = Field(default_factory=ClientInfo)


class ObservationPayload(BaseModel):
    snapshot: ObservationSnapshot


class ActionResultClientPayload(BaseModel):
    """docs/05 §6: contains the ActionResult defined in docs/03 §18."""

    result: ActionResultModel


class ConfirmationResponsePayload(BaseModel):
    confirmation_id: str = Field(min_length=1)
    decision: Literal["approve", "deny"]


class EmptyPayload(BaseModel):
    """Shape of cancel_task / manual_action_completed."""


class ClientErrorPayload(BaseModel):
    code: str = Field(min_length=1)
    message: str = ""


CLIENT_EVENT_TYPES: dict[str, type[BaseModel]] = {
    "start_task": StartTaskPayload,
    "observation": ObservationPayload,
    "action_result": ActionResultClientPayload,
    "confirmation_response": ConfirmationResponsePayload,
    "manual_action_completed": EmptyPayload,
    "cancel_task": EmptyPayload,
    "client_error": ClientErrorPayload,
}


# ---------------------------------------------------------------------------
# Server -> client payloads (docs/05 §7)
# ---------------------------------------------------------------------------


class TaskCreatedPayload(BaseModel):
    task_id: str
    status: str


class RequestObservationPayload(BaseModel):
    reason: ObservationReason


class ActionRequestPayload(BaseModel):
    action: BrowserActionRequest
    policy: str
    confirmation_token: str | None = None


class ConfirmationRequestPayload(BaseModel):
    confirmation_id: str
    action_id: str
    title: str
    summary: str
    risk: str
    expires_at_ms: int


class ManualActionRequestPayload(BaseModel):
    reason: str
    instruction: str


class StatusPayload(BaseModel):
    state: str
    detail: str = ""


class TaskCompletedPayload(BaseModel):
    task_id: str
    summary: str
    metrics: dict[str, Any] = Field(default_factory=dict)
    trace: dict[str, Any] | None = None


class TaskFailedPayload(BaseModel):
    task_id: str | None = None
    code: str
    message: str
    trace: dict[str, Any] | None = None


def parse_envelope(raw: object) -> Envelope:
    envelope = Envelope.model_validate(raw)
    if envelope.protocol_version != PROTOCOL_VERSION:
        raise ProtocolVersionError(f"Unsupported protocol version {envelope.protocol_version}")
    return envelope


def validate_client_payload(envelope: Envelope) -> BaseModel:
    model = CLIENT_EVENT_TYPES.get(envelope.type)
    if model is None:
        raise InvalidEventError(f"Unknown event type: {envelope.type}")
    return model.model_validate(envelope.payload)
