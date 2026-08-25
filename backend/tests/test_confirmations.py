"""Confirmation binding and token tests (docs/06 §9, docs/03 §20)."""

from uuid import uuid4

import pytest

from app.agent.confirmations import (
    Confirmation,
    build_token,
    create_confirmation,
    decode_token,
    summary_for,
    verify_token,
)
from app.protocols.actions import BrowserActionRequest, ExpectedTarget


def request() -> BrowserActionRequest:
    return BrowserActionRequest(
        action_id="act-1",
        document_id="doc-1",
        observed_mutation_epoch=7,
        tool="click_element",
        args={"element_id": 11},
        expected_target=ExpectedTarget(
            role="button", normalized_name="place order", tag_name="button"
        ),
    )


def test_token_roundtrip_and_binding_valid() -> None:
    confirmation = create_confirmation(uuid4(), request(), ttl_seconds=60)
    token = build_token(confirmation, request())
    assert verify_token(token, request()) is None


def test_expired_token_rejected() -> None:
    confirmation = create_confirmation(uuid4(), request(), ttl_seconds=-1)
    token = build_token(confirmation, request())
    violation = verify_token(token, request())
    assert violation == "confirmation expired"


def test_tampered_action_id_rejected() -> None:
    confirmation = create_confirmation(uuid4(), request())
    token = build_token(confirmation, request())
    tampered_request = request()
    tampered_request.action_id = "act-999"
    assert "bound to a different action" in verify_token(token, tampered_request)


def test_changed_document_rejected() -> None:
    confirmation = create_confirmation(uuid4(), request())
    token = build_token(confirmation, request())
    moved = request()
    moved.document_id = "doc-2"
    assert verify_token(token, moved) is not None


def test_changed_target_fingerprint_rejected() -> None:
    # docs/09 M6: a changed target invalidates the approval.
    confirmation = create_confirmation(uuid4(), request())
    token = build_token(confirmation, request())
    replaced = request()
    replaced.expected_target = ExpectedTarget(
        role="link", normalized_name="harmless link", tag_name="a"
    )
    assert "different target fingerprint" in (verify_token(token, replaced) or "")


def test_malformed_token_rejected() -> None:
    assert verify_token("not-a-token", request()) is not None
    assert decode_token("") is None


def test_missing_token_flagged() -> None:
    assert verify_token(None, request()) is not None  # type: ignore[arg-type]


def test_summary_is_stable_and_safe() -> None:
    text = summary_for(request())
    assert "click_element" in text
    assert "place order" in text


def test_confirmation_expiry_timestamp_matches_ttl() -> None:
    from datetime import UTC, datetime

    before = datetime.now(UTC)
    confirmation: Confirmation = create_confirmation(
        uuid4(), request(), ttl_seconds=120, now=before
    )
    delta = (confirmation.expires_at - confirmation.created_at).total_seconds()
    assert delta == pytest.approx(120)
