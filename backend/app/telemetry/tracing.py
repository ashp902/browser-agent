"""Task trace construction and semantic hashing (docs/08 §13-§14).

A trace distinguishes where a task stopped: perception, reasoning, stale
target, executor, policy block, permission/navigation block, user denial, or
completion. Traces contain action summaries and codes only - never page text
beyond what the summaries already include.

The semantic hash is a normalized digest of the model-facing text with volatile
fields removed. It is a loop/progress signal only, never an integrity check.
"""

import hashlib
import re
from typing import Any

from app.sessions.models import AgentSession

_VOLATILE_PATTERNS = (
    (re.compile(r' snapshot="[^"]*"'), ' snapshot=""'),
    (re.compile(r" epoch=\d+"), " epoch=0"),
)


def semantic_hash(semantic_text: str) -> str:
    normalized = semantic_text
    for pattern, replacement in _VOLATILE_PATTERNS:
        normalized = pattern.sub(replacement, normalized)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


def build_trace(session: AgentSession) -> dict[str, Any]:
    steps: list[dict[str, Any]] = []
    for record in session.history:
        step: dict[str, Any] = {
            "step": record.step,
            "snapshot_id": record.snapshot_id,
            "action": record.action,
            "policy": record.policy,
            "result_summary": record.result_summary,
            "error_code": record.error_code,
        }
        steps.append({k: v for k, v in step.items() if v is not None})

    return {
        "task_id": str(session.task_id),
        "status": session.status.value,
        "step_count": session.step_count,
        "terminal_reason": session.terminal_reason,
        "steps": steps,
    }
