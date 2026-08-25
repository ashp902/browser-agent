"""Wire event schema tests (docs/05 §18)."""

import pytest
from pydantic import ValidationError

from app.protocols.actions import ActionResultModel
from app.protocols.events import (
    CLIENT_EVENT_TYPES,
    InvalidEventError,
    ProtocolVersionError,
    parse_envelope,
    validate_client_payload,
)


def envelope(type_: str, payload: dict, **overrides) -> dict:
    frame = {
        "protocol_version": 1,
        "event_id": "evt-1",
        "task_id": None,
        "type": type_,
        "timestamp_ms": 0,
        "payload": payload,
    }
    frame.update(overrides)
    return frame


def observation_payload() -> dict:
    return {
        "snapshot": {
            "document_id": "doc-1",
            "snapshot_id": "snap-1",
            "mutation_epoch": 3,
            "url": "https://shop.example/",
            "origin": "https://shop.example",
            "title": "Shop",
            "semantic_text": 'PAGE title="Shop"',
            "actionable_fingerprints": {
                "5": {"role": "button", "normalized_name": "buy", "tag_name": "button"}
            },
            "stats": {
                "node_count": 4,
                "actionable_count": 1,
                "truncated_nodes": 0,
                "snapshot_truncated": False,
                "serialized_chars": 42,
            },
        }
    }


def action_result_payload(action_id: str = "act-1") -> dict:
    result = ActionResultModel(
        action_id=action_id,
        document_id="doc-1",
        mutation_epoch_before=3,
        mutation_epoch_after=4,
        ok=True,
        summary='Clicked button "Buy".',
    )
    return {"result": result.model_dump()}


@pytest.mark.parametrize("type_", sorted(CLIENT_EVENT_TYPES))
def test_every_client_event_type_validates(type_: str) -> None:
    payloads: dict[str, dict] = {
        "start_task": {"goal": "Find shoes", "client": {"extension_version": "0.1.0"}},
        "observation": observation_payload(),
        "action_result": action_result_payload(),
        "confirmation_response": {"confirmation_id": "c-1", "decision": "approve"},
        "manual_action_completed": {},
        "cancel_task": {},
        "client_error": {"code": "LOCAL_TIMEOUT", "message": "boom"},
    }
    parsed = parse_envelope(envelope(type_, payloads[type_]))
    model = validate_client_payload(parsed)
    assert model is not None


def test_protocol_version_must_be_one() -> None:
    with pytest.raises(ProtocolVersionError):
        parse_envelope(envelope("cancel_task", {}, protocol_version=2))


def test_unknown_event_type_is_invalid() -> None:
    parsed = parse_envelope(envelope("run_arbitrary_js", {"code": "alert(1)"}))
    with pytest.raises(InvalidEventError):
        validate_client_payload(parsed)


def test_invalid_payload_for_known_type_raises_value_error() -> None:
    parsed = parse_envelope(envelope("start_task", {}))  # missing goal
    with pytest.raises(ValidationError):
        validate_client_payload(parsed)


def test_envelope_rejects_extra_fields() -> None:
    with pytest.raises(ValidationError):
        parse_envelope(envelope("cancel_task", {}, sneaky="injection"))


def test_action_result_requires_full_contract_shape() -> None:
    bad = {"result": {"ok": True, "summary": "partial"}}
    parsed = parse_envelope(envelope("action_result", bad))
    with pytest.raises(ValidationError):
        validate_client_payload(parsed)
