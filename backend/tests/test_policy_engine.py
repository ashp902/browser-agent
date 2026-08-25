"""Deterministic policy engine tests (docs/06 §7-§8)."""

import pytest

from app.agent.tool_catalog import ValidatedAction
from app.policy.engine import PolicyContext, PolicyEngine, PolicyResult, nearby_text_for
from app.protocols.actions import ExpectedTarget


def action(
    tool: str = "click_element",
    args: dict | None = None,
    role: str = "button",
    name: str = "",
    input_type: str | None = None,
) -> ValidatedAction:
    return ValidatedAction(
        tool=tool,
        args=args if args is not None else {"element_id": 1},
        expected_target=ExpectedTarget(
            role=role,
            normalized_name=name,
            tag_name="button",
            input_type=input_type,
        ),
    )


def context(url: str = "https://shop.example/products", nearby: str = "") -> PolicyContext:
    return PolicyContext(url=url, nearby_text=nearby)


@pytest.fixture()
def engine() -> PolicyEngine:
    return PolicyEngine()


def test_search_and_filters_allow(engine: PolicyEngine) -> None:
    assert engine.evaluate(action(name="search products"), context()).result == PolicyResult.ALLOW
    assert engine.evaluate(action(name="black"), context()).result == PolicyResult.ALLOW
    assert (
        engine.evaluate(
            action(
                tool="set_text",
                args={"element_id": 2, "text": "shoes"},
                name="search",
                role="textbox",
                input_type="search",
            ),
            context(),
        ).result
        == PolicyResult.ALLOW
    )


def test_place_order_requires_confirmation(engine: PolicyEngine) -> None:
    decision = engine.evaluate(action(name="place order"), context())
    assert decision.result == PolicyResult.REQUIRE_CONFIRMATION


@pytest.mark.parametrize(
    "name",
    [
        "buy now",
        "purchase",
        "pay now",
        "submit payment",
        "transfer funds",
        "send message",
        "book appointment",
        "confirm booking",
        "cancel subscription",
        "delete account",
        "delete",
        "publish post",
        "agree and submit",
    ],
)
def test_consequence_keyword_families_require_confirmation(engine: PolicyEngine, name: str) -> None:
    assert engine.evaluate(action(name=name), context()).result == PolicyResult.REQUIRE_CONFIRMATION


def test_word_boundaries_prevent_false_positives(engine: PolicyEngine) -> None:
    # "book" must not fire inside unrelated words.
    assert engine.evaluate(action(name="facebook share"), context()).result == PolicyResult.ALLOW


def test_nearby_text_can_escalate_to_confirmation(engine: PolicyEngine) -> None:
    # A generically-named button sitting under a "Place order" heading.
    nearby = 'REGION @10 "Checkout" TEXT "Place order - $89.00" BUTTON @11 "Continue"'
    decision = engine.evaluate(action(name="continue"), context(nearby=nearby))
    assert decision.result == PolicyResult.REQUIRE_CONFIRMATION


def test_password_entry_is_manual_only(engine: PolicyEngine) -> None:
    decision = engine.evaluate(
        action(
            tool="set_text",
            args={"element_id": 3, "text": "x"},
            name="password",
            role="textbox",
            input_type="password",
        ),
        context(),
    )
    assert decision.result == PolicyResult.REQUIRE_MANUAL_USER_ACTION


@pytest.mark.parametrize("name", ["card number", "cvv", "security code", "one-time code"])
def test_secret_named_fields_are_manual_only(engine: PolicyEngine, name: str) -> None:
    decision = engine.evaluate(
        action(tool="set_text", args={"element_id": 3, "text": "x"}, name=name, role="textbox"),
        context(),
    )
    assert decision.result == PolicyResult.REQUIRE_MANUAL_USER_ACTION


def test_captcha_is_manual_only(engine: PolicyEngine) -> None:
    decision = engine.evaluate(action(name="i am not a robot"), context())
    assert decision.result == PolicyResult.REQUIRE_MANUAL_USER_ACTION


def test_forbidden_navigation_scheme_denied(engine: PolicyEngine) -> None:
    decision = engine.evaluate(
        action(tool="navigate_current_tab", args={"url": "javascript:alert(1)"}, role="link"),
        context(),
    )
    assert decision.result == PolicyResult.DENY


def test_ordinary_https_navigation_allowed(engine: PolicyEngine) -> None:
    decision = engine.evaluate(
        action(
            tool="navigate_current_tab", args={"url": "https://shop.example/orders"}, role="link"
        ),
        context(),
    )
    assert decision.result == PolicyResult.ALLOW


def test_cart_operations_allow_without_confirmation(engine: PolicyEngine) -> None:
    # docs/06 §7.2: reversible cart changes are allowed without confirmation.
    assert engine.evaluate(action(name="buy"), context()).result == PolicyResult.ALLOW
    assert engine.evaluate(action(name="remove"), context()).result == PolicyResult.ALLOW


def test_nearby_text_extraction() -> None:
    semantic = 'MAIN @1\n  REGION @2\n    TEXT "Place order"\n    BUTTON @7 "Go"\n'
    window = nearby_text_for(semantic, 7)
    assert "@7" in window
    assert "Place order" in window
    assert nearby_text_for(semantic, 999) == ""


def test_legal_agreement_checkbox_requires_confirmation(engine: PolicyEngine) -> None:
    decision = engine.evaluate(
        action(
            tool="set_checked", args={"element_id": 4, "checked": True}, name="i accept the terms"
        ),
        context(),
    )
    assert decision.result == PolicyResult.REQUIRE_CONFIRMATION


def test_relative_navigation_urls_resolve_before_scheme_check(engine: PolicyEngine) -> None:
    # docs/03 §15: relative URLs resolve against the current document first,
    # so an ordinary in-app path must not be denied as a scheme violation.
    decision = engine.evaluate(
        action(
            tool="navigate_current_tab",
            args={"url": "/orders"},
            role="link",
        ),
        context(url="https://shop.example/products"),
    )
    assert decision.result == PolicyResult.ALLOW


def test_relative_navigation_still_cannot_smuggle_schemes(engine: PolicyEngine) -> None:
    decision = engine.evaluate(
        action(
            tool="navigate_current_tab",
            args={"url": "javascript:alert(1)"},
            role="link",
        ),
        context(url="https://shop.example/products"),
    )
    assert decision.result == PolicyResult.DENY
