"""Task session domain models and the state machine (docs/04 §2-§3).

State ordering is enforced: illegal transitions raise InvalidTransition. The
frozen MVP states follow docs/04 exactly.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from app.protocols.actions import BrowserActionRequest
from app.protocols.observations import ObservationSnapshot


class TaskStatus(StrEnum):
    CREATED = "CREATED"
    WAITING_OBSERVATION = "WAITING_OBSERVATION"
    THINKING = "THINKING"
    WAITING_ACTION_RESULT = "WAITING_ACTION_RESULT"
    WAITING_CONFIRMATION = "WAITING_CONFIRMATION"
    WAITING_MANUAL_ACTION = "WAITING_MANUAL_ACTION"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELED = "CANCELED"


TERMINAL_STATUSES = {TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELED}

_TRANSITIONS: dict[TaskStatus, set[TaskStatus]] = {
    TaskStatus.CREATED: {TaskStatus.WAITING_OBSERVATION},
    TaskStatus.WAITING_OBSERVATION: {TaskStatus.THINKING},
    TaskStatus.THINKING: {
        TaskStatus.WAITING_ACTION_RESULT,
        TaskStatus.WAITING_CONFIRMATION,
        TaskStatus.WAITING_MANUAL_ACTION,
        TaskStatus.COMPLETED,
    },
    TaskStatus.WAITING_ACTION_RESULT: {TaskStatus.WAITING_OBSERVATION},
    # -> WAITING_ACTION_RESULT only after affirmative confirmation (docs/01 §10).
    TaskStatus.WAITING_CONFIRMATION: {TaskStatus.WAITING_ACTION_RESULT, TaskStatus.THINKING},
    # Resume from a manual step always re-observes first (docs/04 §19).
    TaskStatus.WAITING_MANUAL_ACTION: {TaskStatus.WAITING_OBSERVATION},
    TaskStatus.COMPLETED: set(),
    TaskStatus.FAILED: set(),
    TaskStatus.CANCELED: set(),
}

_ACTIVE_TERMINAL: set[TaskStatus] = TERMINAL_STATUSES


class InvalidTransition(Exception):
    def __init__(self, current: TaskStatus, target: TaskStatus) -> None:
        super().__init__(f"Illegal task transition: {current.value} -> {target.value}")
        self.current = current
        self.target = target


def transition(session: "AgentSession", target: TaskStatus) -> None:
    if session.status in _ACTIVE_TERMINAL:
        raise InvalidTransition(session.status, target)
    allowed = _TRANSITIONS[session.status]
    # Any active status may fail or be canceled (docs/04 §2).
    if target in {TaskStatus.FAILED, TaskStatus.CANCELED}:
        session.status = target
        return
    if target not in allowed:
        raise InvalidTransition(session.status, target)
    session.status = target


@dataclass(slots=True)
class StepRecord:
    step: int
    snapshot_id: str | None = None
    action: dict[str, Any] | None = None
    policy: str | None = None
    result_summary: str | None = None
    error_code: str | None = None
    """Loop-detection signature captured at decision time (docs/04 §15)."""
    signature: str | None = None


@dataclass(slots=True)
class PendingConfirmation:
    """Frozen consequential action awaiting an affirmative user response."""

    request: BrowserActionRequest
    policy: str
    confirmation_id: str
    expires_at_ms: int


@dataclass(slots=True)
class PendingAction:
    request: BrowserActionRequest
    policy: str
    """Loop-detection signature: semantic hash + tool + normalized args
    (docs/04 §15). Captured at decision time against the observed page."""
    signature: str


@dataclass(slots=True)
class AgentSession:
    task_id: UUID
    user_goal: str
    status: TaskStatus = TaskStatus.CREATED
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    step_count: int = 0
    max_steps: int = 25
    latest_snapshot: ObservationSnapshot | None = None
    history: list[StepRecord] = field(default_factory=list)
    pending_action: PendingAction | None = None
    pending_confirmation: PendingConfirmation | None = None
    canceled: bool = False
    terminal_reason: str | None = None

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL_STATUSES
