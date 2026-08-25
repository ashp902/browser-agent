"""Deterministic policy engine (docs/06 §7-§8, docs/00 §3.9).

A model request never authorizes an action: this engine classifies each
validated action as ALLOW / REQUIRE_CONFIRMATION / REQUIRE_MANUAL_USER_ACTION /
DENY using target fingerprint, tool, arguments, URL, and bounded nearby text
from the observation. Order of precedence: DENY > MANUAL > CONFIRM > ALLOW.
"""

import re
from dataclasses import dataclass

from app.agent.tool_catalog import ValidatedAction
from app.policy.rules import (
    CAPTCHA_PHRASES,
    CONFIRM_PHRASES,
    SECRET_FIELD_PHRASES,
    SUSPICIOUS_URL_PHRASES,
    contains_phrase,
)


class PolicyResult:
    ALLOW = "ALLOW"
    REQUIRE_CONFIRMATION = "REQUIRE_CONFIRMATION"
    REQUIRE_MANUAL_USER_ACTION = "REQUIRE_MANUAL_USER_ACTION"
    DENY = "DENY"


@dataclass(slots=True)
class PolicyContext:
    """Observation-derived context for classification (docs/00 §3.9)."""

    url: str
    # Bounded text immediately surrounding the target's line in the compact
    # semantic view; supplies the "nearby short text" cue deterministically.
    nearby_text: str = ""


@dataclass(slots=True)
class PolicyDecision:
    result: str
    reason: str


def nearby_text_for(semantic_text: str, element_id: int | None) -> str:
    """Lines around the target's `@<id>` line (bounded deterministic window)."""
    if element_id is None:
        return ""
    lines = semantic_text.splitlines()
    marker = f"@{element_id} "
    for index, line in enumerate(lines):
        if marker in line:
            window = lines[max(0, index - 2) : index + 3]
            return " ".join(window)
    return ""


class PolicyEngine:
    def evaluate(self, action: ValidatedAction, context: PolicyContext) -> PolicyDecision:
        name = action.expected_target.normalized_name if action.expected_target else ""
        input_type = action.expected_target.input_type if action.expected_target else None

        # --- DENY ---------------------------------------------------------
        if action.tool == "navigate_current_tab":
            # docs/03 §15: resolve relative URLs against the current document
            # BEFORE any policy consideration.
            from urllib.parse import urljoin

            resolved = urljoin(context.url, str(action.args.get("url", "")))
            if not re.match(r"^https?://", resolved):
                return PolicyDecision(PolicyResult.DENY, "forbidden navigation scheme")

        # --- manual-only (docs/06 §7.3) ------------------------------------
        if action.tool == "set_text":
            if input_type == "password":
                return PolicyDecision(
                    PolicyResult.REQUIRE_MANUAL_USER_ACTION, "password entry is manual"
                )
            if contains_phrase(SECRET_FIELD_PHRASES, name):
                return PolicyDecision(
                    PolicyResult.REQUIRE_MANUAL_USER_ACTION,
                    f"'{name}' looks like a secret or payment field",
                )
        if contains_phrase(CAPTCHA_PHRASES, name, context.nearby_text):
            return PolicyDecision(
                PolicyResult.REQUIRE_MANUAL_USER_ACTION, "captcha challenges are manual"
            )

        # --- require confirmation (docs/06 §7.2) ----------------------------
        if action.tool in ("click_element", "press_key") and contains_phrase(
            CONFIRM_PHRASES, name, context.nearby_text
        ):
            return PolicyDecision(
                PolicyResult.REQUIRE_CONFIRMATION,
                f"consequential control '{name or 'unnamed'}'",
            )
        if action.tool == "set_checked" and contains_phrase(("agree", "terms", "consent"), name):
            return PolicyDecision(PolicyResult.REQUIRE_CONFIRMATION, "legal-agreement checkbox")
        if action.tool == "navigate_current_tab" and contains_phrase(
            SUSPICIOUS_URL_PHRASES, context.url, str(action.args.get("url", ""))
        ):
            return PolicyDecision(PolicyResult.REQUIRE_CONFIRMATION, "suspicious navigation target")

        # docs/06 §7.1 default allow: read/navigation interactions such as
        # search, filters, sort, cart add/remove, ordinary information pages.
        return PolicyDecision(PolicyResult.ALLOW, "default allow")
