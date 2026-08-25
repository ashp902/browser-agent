"""Provider boundary (docs/04 §4). Providers convert project-native decision
requests into project-native decisions; provider-specific SDK shapes never
leave this package."""

from dataclasses import dataclass, field
from typing import Any, Protocol

from app.protocols.actions import BrowserToolName
from app.protocols.observations import ObservationSnapshot
from app.sessions.models import StepRecord


@dataclass(slots=True)
class AgentDecisionRequest:
    goal: str
    observation: ObservationSnapshot
    history: list[StepRecord] = field(default_factory=list)
    tools: tuple[BrowserToolName, ...] = ()


@dataclass(slots=True)
class ActionDecision:
    tool: BrowserToolName
    args: dict[str, Any]


@dataclass(slots=True)
class FinishDecision:
    summary: str


AgentDecision = ActionDecision | FinishDecision


class DecisionValidationError(Exception):
    """The provider returned a decision that fails schema/observation checks."""

    def __init__(self, violations: list[str]) -> None:
        super().__init__("; ".join(violations))
        self.violations = violations


class ProviderTimeoutError(Exception):
    pass


class LLMProvider(Protocol):
    async def decide(self, request: AgentDecisionRequest) -> AgentDecision: ...
