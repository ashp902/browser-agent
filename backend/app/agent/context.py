"""Context-size strategy for model input (docs/04 §12).

The last 8 steps are provided verbatim; older steps collapse into a short
deterministic summary line. Hidden model reasoning never appears here - step
records carry actions and outcomes only.
"""

from app.sessions.models import StepRecord

VERBATIM_STEPS = 8


def compact_history(history: list[StepRecord]) -> list[str]:
    if not history:
        return []

    lines: list[str] = []
    older = history[:-VERBATIM_STEPS]
    recent = history[-VERBATIM_STEPS:]

    if older:
        failures = sum(1 for record in older if record.error_code is not None)
        tools = sorted({str((record.action or {}).get("tool")) for record in older})
        lines.append(
            f"- ({len(older)} earlier steps summarized: tools={','.join(tools) or 'none'};"
            f" failures={failures})"
        )

    for record in recent:
        action = record.action or {}
        tool = action.get("tool", "?")
        element = (action.get("args") or {}).get("element_id", "")
        outcome = record.error_code if record.error_code else "ok"
        lines.append(f"- Step {record.step}: {tool}({element}) -> {outcome}")

    return lines
