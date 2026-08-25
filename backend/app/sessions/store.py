"""Session persistence interface (docs/05 §9). In-memory store for the local
MVP; the async interface keeps persistence swappable later."""

from typing import Protocol
from uuid import UUID

from app.sessions.models import AgentSession


class SessionStore(Protocol):
    async def create(self, session: AgentSession) -> None: ...
    async def get(self, task_id: UUID) -> AgentSession | None: ...
    async def save(self, session: AgentSession) -> None: ...
    async def delete(self, task_id: UUID) -> None: ...


class InMemorySessionStore:
    def __init__(self) -> None:
        self._sessions: dict[UUID, AgentSession] = {}

    async def create(self, session: AgentSession) -> None:
        self._sessions[session.task_id] = session

    async def get(self, task_id: UUID) -> AgentSession | None:
        return self._sessions.get(task_id)

    async def save(self, session: AgentSession) -> None:
        self._sessions[session.task_id] = session

    async def delete(self, task_id: UUID) -> None:
        self._sessions.pop(task_id, None)
