"""Task state machine tests (docs/04 §2)."""

import pytest

from app.sessions.models import (
    AgentSession,
    InvalidTransition,
    TaskStatus,
    transition,
)


def session(status: TaskStatus = TaskStatus.CREATED) -> AgentSession:
    from uuid import uuid4

    return AgentSession(task_id=uuid4(), user_goal="goal", status=status)


def test_canonical_happy_path() -> None:
    s = session()
    transition(s, TaskStatus.WAITING_OBSERVATION)
    transition(s, TaskStatus.THINKING)
    transition(s, TaskStatus.WAITING_ACTION_RESULT)
    transition(s, TaskStatus.WAITING_OBSERVATION)
    transition(s, TaskStatus.THINKING)
    transition(s, TaskStatus.COMPLETED)
    assert s.is_terminal


def test_thinking_to_confirmation_now_wired() -> None:
    # Safety gates (docs/09 M6): THINKING -> WAITING_CONFIRMATION and
    # WAITING_MANUAL_ACTION are legal; confirmation resumes only into ACTION.
    s = session(TaskStatus.THINKING)
    transition(s, TaskStatus.WAITING_CONFIRMATION)
    transition(s, TaskStatus.WAITING_ACTION_RESULT)
    s2 = session(TaskStatus.THINKING)
    transition(s2, TaskStatus.WAITING_MANUAL_ACTION)
    transition(s2, TaskStatus.WAITING_OBSERVATION)
    with pytest.raises(InvalidTransition):
        transition(session(TaskStatus.WAITING_CONFIRMATION), TaskStatus.COMPLETED)


def test_any_active_status_fails_or_cancels() -> None:
    for status in [
        TaskStatus.CREATED,
        TaskStatus.WAITING_OBSERVATION,
        TaskStatus.THINKING,
        TaskStatus.WAITING_ACTION_RESULT,
    ]:
        s = session(status)
        transition(s, TaskStatus.CANCELED)
        assert s.status is TaskStatus.CANCELED

        s2 = session(status)
        transition(s2, TaskStatus.FAILED)
        assert s2.status is TaskStatus.FAILED


def test_terminal_states_are_final() -> None:
    for status in [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELED]:
        s = session(status)
        for target in [
            TaskStatus.WAITING_OBSERVATION,
            TaskStatus.THINKING,
            TaskStatus.WAITING_ACTION_RESULT,
            TaskStatus.COMPLETED,
        ]:
            with pytest.raises(InvalidTransition):
                transition(s, target)


def test_created_cannot_skip_to_thinking() -> None:
    s = session()
    with pytest.raises(InvalidTransition):
        transition(s, TaskStatus.THINKING)


def test_completed_cannot_act_again() -> None:
    # docs/01 §10 example: COMPLETED -> ACTING is invalid.
    s = session(TaskStatus.COMPLETED)
    with pytest.raises(InvalidTransition):
        transition(s, TaskStatus.WAITING_ACTION_RESULT)
