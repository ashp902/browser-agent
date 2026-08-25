"""WebSocket endpoint integration tests (docs/05 §5-§8, §13)."""

import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import build_runtime, create_app
from app.settings import Settings


def mock_runtime():
    """Runtime pinned to the mock provider regardless of local backend/.env."""
    return build_runtime(Settings(_env_file=None, llm_provider="mock"))


def frame(type_: str, payload: dict, task_id: str | None = None, protocol_version: int = 1) -> dict:
    return {
        "protocol_version": protocol_version,
        "event_id": f"evt-{time.monotonic_ns()}",
        "task_id": task_id,
        "type": type_,
        "timestamp_ms": 0,
        "payload": payload,
    }


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
                "serialized_chars": 40,
            },
        }
    }


def test_health_endpoints_do_not_expose_details() -> None:
    app = create_app(runtime=mock_runtime())
    client = TestClient(app)
    assert client.get("/healthz").json() == {"status": "ok"}
    assert client.get("/readyz").json() == {"status": "ready"}


def test_full_task_traversal_over_websocket() -> None:
    app = create_app(runtime=mock_runtime())
    client = TestClient(app)
    with client.websocket_connect("/v1/agent/ws") as ws:
        ws.send_json(
            frame("start_task", {"goal": "Demo", "client": {"extension_version": "0.1.0"}})
        )
        created = ws.receive_json()
        assert created["type"] == "task_created"
        task_id = created["payload"]["task_id"]

        first_request = ws.receive_json()
        assert first_request["type"] == "request_observation"
        assert first_request["payload"]["reason"] == "initial"

        ws.send_json(frame("observation", observation_payload(), task_id=task_id))

        action_request = ws.receive_json()
        assert action_request["type"] == "action_request"
        assert action_request["payload"]["policy"] == "ALLOW"
        action = action_request["payload"]["action"]
        assert action["tool"] == "click_element"
        assert action["document_id"] == "doc-1"
        assert action["observed_mutation_epoch"] == 3
        assert action["expected_target"]["normalized_name"] == "buy"

        result = {
            "result": {
                "protocol_version": 1,
                "action_id": action["action_id"],
                "document_id": "doc-1",
                "mutation_epoch_before": 3,
                "mutation_epoch_after": 4,
                "ok": True,
                "changed": True,
                "summary": 'Clicked button "Buy".',
            }
        }
        ws.send_json(frame("action_result", result, task_id=task_id))

        second_request = ws.receive_json()
        assert second_request["type"] == "request_observation"
        # The 250 ms stabilization delay precedes the after_action request.
        assert second_request["payload"]["reason"] == "after_action"

        ws.send_json(frame("observation", observation_payload(), task_id=task_id))
        completed = ws.receive_json()
        assert completed["type"] == "task_completed"
        assert completed["payload"]["metrics"]["steps"] == 2
        assert completed["payload"]["trace"]["terminal_reason"] == "finish"
        # The executed click lives on the step that observed its result.
        assert completed["payload"]["trace"]["steps"][0]["action"]["tool"] == "click_element"
        assert (
            completed["payload"]["trace"]["steps"][0]["result_summary"] == 'Clicked button "Buy".'
        )


def test_protocol_version_rejected_explicitly() -> None:
    app = create_app(runtime=mock_runtime())
    client = TestClient(app)
    with client.websocket_connect("/v1/agent/ws") as ws:
        ws.send_json(frame("cancel_task", {}, protocol_version=99))
        rejected = ws.receive_json()
        assert rejected["type"] == "task_failed"
        assert rejected["payload"]["code"] == "INVALID_PROTOCOL"
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()


def test_unknown_event_type_rejected_explicitly() -> None:
    app = create_app(runtime=mock_runtime())
    client = TestClient(app)
    with client.websocket_connect("/v1/agent/ws") as ws:
        ws.send_json(frame("run_arbitrary_js", {"code": "alert(1)"}))
        rejected = ws.receive_json()
        assert rejected["payload"]["code"] == "INVALID_EVENT"
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()


def test_malformed_json_rejected() -> None:
    app = create_app(runtime=mock_runtime())
    client = TestClient(app)
    with client.websocket_connect("/v1/agent/ws") as ws:
        ws.send_text("this is not json{")
        rejected = ws.receive_json()
        assert rejected["payload"]["code"] == "INVALID_EVENT"
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()


def test_event_without_active_task_reports_not_found() -> None:
    app = create_app(runtime=mock_runtime())
    client = TestClient(app)
    with client.websocket_connect("/v1/agent/ws") as ws:
        ws.send_json(frame("cancel_task", {}, task_id="00000000-0000-0000-0000-000000000000"))
        failed = ws.receive_json()
        assert failed["type"] == "task_failed"
        assert failed["payload"]["code"] == "TASK_NOT_FOUND"


def test_invalid_known_type_payload_keeps_connection_open() -> None:
    app = create_app(runtime=mock_runtime())
    client = TestClient(app)
    with client.websocket_connect("/v1/agent/ws") as ws:
        ws.send_json(frame("start_task", {}))  # missing goal
        failed = ws.receive_json()
        assert failed["payload"]["code"] == "INVALID_EVENT"

        # Recovery: a valid start works on the same connection.
        ws.send_json(frame("start_task", {"goal": "Try again"}))
        created = ws.receive_json()
        assert created["type"] == "task_created"


def test_cancellation_flow_over_websocket() -> None:
    app = create_app(runtime=mock_runtime())
    client = TestClient(app)
    with client.websocket_connect("/v1/agent/ws") as ws:
        ws.send_json(frame("start_task", {"goal": "Cancel me"}))
        created = ws.receive_json()
        task_id = created["payload"]["task_id"]
        ws.receive_json()  # request_observation initial

        ws.send_json(frame("cancel_task", {}, task_id=task_id))
        failed = ws.receive_json()
        assert failed["type"] == "task_failed"
        assert failed["payload"]["code"] == "CANCELED"
        assert failed["payload"]["trace"] is not None


def test_disconnect_marks_session_terminal() -> None:
    runtime = mock_runtime()
    app = create_app(runtime=runtime)
    task_id: str | None = None
    client = TestClient(app)
    with client.websocket_connect("/v1/agent/ws") as ws:
        ws.send_json(frame("start_task", {"goal": "Dropped"}))
        created = ws.receive_json()
        task_id = created["payload"]["task_id"]
        ws.receive_json()  # request_observation
    # Context exit disconnects; the orchestrator safe-stops the session.

    import asyncio

    async def wait_terminal() -> None:
        from uuid import UUID

        for _ in range(100):
            stored = await runtime.store.get(UUID(task_id))  # type: ignore[arg-type]
            if stored is not None and stored.is_terminal:
                return
            await asyncio.sleep(0.02)
        raise AssertionError("session never became terminal")

    asyncio.run(wait_terminal())
