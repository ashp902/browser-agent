"""Model-facing tool catalog and decision validation (docs/04 §7-§8).

The catalog is the finite tool set advertised to any decider. Decisions are
validated OUTSIDE the model: unknown tools, malformed args, and element IDs
absent from the latest observation are rejected here, never in the page.
"""

from dataclasses import dataclass
from typing import Any

from app.protocols.actions import BROWSER_TOOLS, ExpectedTarget
from app.protocols.observations import ObservationSnapshot
from app.providers.base import ActionDecision, DecisionValidationError

ELEMENT_TARGETED_TOOLS = {
    "click_element",
    "set_text",
    "select_option",
    "set_checked",
    "scroll_element",
}

ALLOWED_PRESS_KEYS = {
    "Enter",
    "Escape",
    "Tab",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Space",
}

SCROLL_DIRECTIONS = {"up", "down", "top", "bottom"}
SCROLL_AMOUNTS = {"small", "medium", "large"}


@dataclass(slots=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]


def _build_catalog() -> dict[str, ToolSpec]:
    element_ref = {"element_id": {"type": "integer"}, "required": ["element_id"]}
    return {
        "click_element": ToolSpec("click_element", "Click a registered element.", element_ref),
        "set_text": ToolSpec(
            "set_text",
            "Replace text in an ordinary text input or textarea.",
            {
                "element_id": {"type": "integer"},
                "text": {"type": "string"},
                "required": ["element_id", "text"],
            },
        ),
        "select_option": ToolSpec(
            "select_option",
            "Select one option of a native select by value or label.",
            {
                "element_id": {"type": "integer"},
                "option_value": {"type": "string"},
                "option_label": {"type": "string"},
                "required": ["element_id"],
            },
        ),
        "set_checked": ToolSpec(
            "set_checked",
            "Set checkbox/radio checked state.",
            {
                "element_id": {"type": "integer"},
                "checked": {"type": "boolean"},
                "required": ["element_id", "checked"],
            },
        ),
        "press_key": ToolSpec(
            "press_key",
            f"Press an allowed key: {sorted(ALLOWED_PRESS_KEYS)}",
            {"key": {"type": "string"}, "element_id": {"type": "integer"}, "required": ["key"]},
        ),
        "scroll_page": ToolSpec(
            "scroll_page",
            "Scroll the page.",
            {"direction": {}, "amount": {}, "required": ["direction"]},
        ),
        "scroll_element": ToolSpec(
            "scroll_element",
            "Scroll a scrollable container.",
            {
                "element_id": {"type": "integer"},
                "direction": {},
                "amount": {},
                "required": ["element_id", "direction"],
            },
        ),
        "navigate_current_tab": ToolSpec(
            "navigate_current_tab",
            "Navigate the current tab to an http/https URL.",
            {"url": {"type": "string"}, "required": ["url"]},
        ),
        "go_back": ToolSpec("go_back", "Go back in this tab's history.", {}),
    }


TOOL_CATALOG: dict[str, ToolSpec] = _build_catalog()


def _arg_violations(tool: str, args: dict[str, Any]) -> list[str]:
    spec = TOOL_CATALOG[tool]
    violations: list[str] = []
    for required_key in spec.parameters.get("required", []):
        if required_key not in args:
            violations.append(f"{tool}: missing required argument '{required_key}'")

    if "element_id" in spec.parameters:
        value = args.get("element_id")
        if "element_id" in args and (not isinstance(value, int) or isinstance(value, bool)):
            violations.append(f"{tool}: element_id must be an integer")
    if tool == "set_text" and "text" in args and not isinstance(args["text"], str):
        violations.append("set_text: text must be a string")
    if tool == "set_checked" and "checked" in args and not isinstance(args["checked"], bool):
        violations.append("set_checked: checked must be a boolean")
    if tool == "press_key" and "key" in args and args["key"] not in ALLOWED_PRESS_KEYS:
        violations.append(f"press_key: key '{args['key']}' is not allowed")
    if tool in ("scroll_page", "scroll_element"):
        direction = args.get("direction")
        if "direction" in args and direction not in SCROLL_DIRECTIONS:
            violations.append(f"{tool}: invalid direction '{direction}'")
        amount = args.get("amount")
        if amount is not None and amount not in SCROLL_AMOUNTS:
            violations.append(f"{tool}: invalid amount '{amount}'")
    if tool == "navigate_current_tab":
        url = args.get("url")
        if "url" in args and (not isinstance(url, str) or not url.strip()):
            violations.append("navigate_current_tab: url must be a non-empty string")
    if tool == "select_option":
        has_value = isinstance(args.get("option_value"), str)
        has_label = isinstance(args.get("option_label"), str)
        if has_value == has_label:
            violations.append("select_option: provide exactly one of option_value / option_label")
    return violations


@dataclass(slots=True)
class ValidatedAction:
    tool: str
    args: dict[str, Any]
    expected_target: ExpectedTarget | None


def validate_action_decision(
    decision: ActionDecision, observation: ObservationSnapshot
) -> ValidatedAction:
    """Schema + observation validation for one proposed action
    (docs/04 §8). Raises DecisionValidationError on any violation."""
    violations: list[str] = []

    if decision.tool not in BROWSER_TOOLS:
        violations.append(f"unknown tool '{decision.tool}'")
        raise DecisionValidationError(violations)

    violations.extend(_arg_violations(decision.tool, decision.args))

    expected_target: ExpectedTarget | None = None
    if decision.tool in ELEMENT_TARGETED_TOOLS:
        element_id = decision.args.get("element_id")
        if isinstance(element_id, int) and not isinstance(element_id, bool):
            fingerprint = observation.actionable_fingerprints.get(str(element_id))
            if fingerprint is None:
                violations.append(
                    f"{decision.tool}: element {element_id} not in latest observation"
                )
            else:
                expected_target = fingerprint

    if violations:
        raise DecisionValidationError(violations)

    return ValidatedAction(
        tool=decision.tool, args=dict(decision.args), expected_target=expected_target
    )


def tool_schemas(tools: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    """Provider-neutral JSON Schemas for tool advertisement (docs/04 §7)."""
    names = tools or tuple(TOOL_CATALOG)
    schemas: list[dict[str, Any]] = []
    for name in names:
        spec = TOOL_CATALOG[name]
        properties = {k: v for k, v in spec.parameters.items() if k != "required"}
        schemas.append(
            {
                "name": name,
                "description": spec.description,
                "input_schema": {
                    "type": "object",
                    "properties": properties,
                    "required": spec.parameters.get("required", []),
                },
            }
        )
    return schemas
