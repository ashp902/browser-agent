# 05 - Backend and Wire Protocol

Status: AUTHORITATIVE FOR MVP

## 1. Objective

Specify backend boundaries and the exact logical protocol between side panel and backend so the extension and agent can be implemented independently.

## 2. Backend stack

Required:

- Python 3.12+
- FastAPI
- Pydantic v2
- WebSocket endpoint for live task sessions
- asyncio-native orchestration
- provider adapter interface
- structured JSON logs

MVP does not require Redis, Postgres, Celery, Kafka, or a vector database.

Those technologies MUST NOT be added "for scalability" before a documented need.

## 3. Network ownership

Side panel connects directly to backend over TLS in production:

```text
side panel <---- WebSocket/HTTPS ----> backend
```

Content script never calls backend directly.

Service worker does not proxy model traffic unless later required.

## 4. Authentication

MVP local development MAY run without user accounts on localhost.

Production authentication is intentionally unresolved. Code MUST isolate auth middleware so it can be added without changing event schemas.

Do not invent OAuth provider or account database in MVP.

## 5. WebSocket endpoint

Logical endpoint:

```text
GET /v1/agent/ws
```

Actual deployment host is configuration.

Every frame is JSON and conforms to:

```json
{
  "protocol_version": 1,
  "event_id": "uuid",
  "task_id": "uuid-or-null",
  "type": "event_type",
  "timestamp_ms": 0,
  "payload": {}
}
```

Unknown protocol versions MUST be rejected explicitly.

## 6. Client -> server events

### `start_task`

```json
{
  "goal": "Find black running shoes under $100",
  "client": {
    "extension_version": "0.1.0",
    "locale": "en-US"
  }
}
```

Server creates task and responds with status + `request_observation`.

### `observation`

Payload:

```json
{
  "snapshot": {
    "document_id": "...",
    "snapshot_id": "...",
    "mutation_epoch": 12,
    "url": "...",
    "title": "...",
    "semantic_text": "...",
    "actionable_fingerprints": {
      "103": {
        "role": "button",
        "normalized_name": "buy",
        "tag_name": "button"
      }
    },
    "stats": {}
  }
}
```

Do not send raw `Element`-level internal objects, HTML, selectors, or DOM handles.

### `action_result`

Contains `ActionResult` defined in document 03.

### `confirmation_response`

```json
{
  "confirmation_id": "uuid",
  "decision": "approve"
}
```

or `deny`.

### `manual_action_completed`

User explicitly indicates they performed the requested manual step. Server requests a fresh observation.

### `cancel_task`

Cancels task immediately.

### `client_error`

Used to report local extension failures with project-defined safe error codes.

## 7. Server -> client events

### `task_created`

Provides task ID and initial status.

### `request_observation`

Payload may include reason:

```text
initial
after_action
stale_target
manual_resume
final_verification
```

### `action_request`

```json
{
  "action": {
    "action_id": "uuid",
    "document_id": "uuid",
    "observed_mutation_epoch": 12,
    "tool": "click_element",
    "args": {"element_id": 103},
    "expected_target": {
      "role": "button",
      "normalized_name": "buy",
      "tag_name": "button"
    }
  },
  "policy": "ALLOW"
}
```

For approved consequential action, include a short-lived `confirmation_token` generated after user approval.

### `confirmation_request`

```json
{
  "confirmation_id": "uuid",
  "action_id": "uuid",
  "title": "Confirm action",
  "summary": "Place the order for $89.00?",
  "risk": "consequential",
  "expires_at_ms": 0
}
```

### `manual_action_request`

Example:

```json
{
  "reason": "PASSWORD_REQUIRED",
  "instruction": "Enter your password directly on the webpage, then press Resume. Do not send the password in chat."
}
```

### `status`

For UI narration/state. Status strings are not trusted authorization signals.

### `task_completed`

Contains final user-facing summary and task metrics.

### `task_failed`

Contains stable error code and user-safe message.

## 8. Server event ordering

Within one task, server emits events in logical sequence. Side panel MUST ignore an `action_request` if:

- task is canceled/completed/failed locally;
- action task ID does not match active task;
- document context no longer matches and action cannot be validated;
- another action is already in flight.

Only one action may be in flight per task.

## 9. Session persistence interface

Define:

```py
class SessionStore(Protocol):
    async def create(...): ...
    async def get(task_id): ...
    async def save(session): ...
    async def delete(task_id): ...
```

Implement `InMemorySessionStore` for MVP.

No database schema is required yet.

## 10. Settings

Use environment variables through a single typed settings object.

Minimum settings:

```text
ENVIRONMENT
LOG_LEVEL
LLM_PROVIDER
LLM_MODEL
LLM_API_KEY
ALLOWED_EXTENSION_ORIGINS
TASK_MAX_STEPS=25
MODEL_TIMEOUT_SECONDS
```

Never log `LLM_API_KEY`.

## 11. Provider abstraction

Provider adapter converts project-native:

```py
AgentDecisionRequest
```

into provider request and converts result back to:

```py
ActionDecision | FinishDecision
```

Provider adapter MUST not return arbitrary provider SDK objects into orchestrator.

## 12. Timeouts

Initial defaults:

```text
model decision timeout: 30 s
websocket heartbeat interval: 20 s
task idle timeout: 10 min
confirmation timeout: 2 min
```

These are MVP defaults and can be configuration, not magic values scattered in code.

## 13. Reconnect behavior

MVP WebSocket reconnect support is minimal:

- if connection drops, side panel stops issuing actions;
- it may reconnect within the same open side-panel session and send task ID;
- in-memory backend restart loses task; server returns `TASK_NOT_FOUND`;
- no action is automatically replayed without checking action ID/state.

Durable resumability is future scope.

## 14. Error codes

Backend stable codes include:

```text
INVALID_PROTOCOL
INVALID_EVENT
TASK_NOT_FOUND
TASK_ALREADY_TERMINAL
MODEL_TIMEOUT
MODEL_PROTOCOL_ERROR
POLICY_DENIED
CONFIRMATION_EXPIRED
USER_DENIED_ACTION
STEP_LIMIT_REACHED
AGENT_LOOP_DETECTED
PERMISSION_REQUIRED
MANUAL_ACTION_REQUIRED
LOCAL_ACTION_ERROR
CANCELED
INTERNAL_SERVER_ERROR
```

## 15. Telemetry separation

Agent context and telemetry are different data products.

- Agent context may temporarily contain semantic page data needed to perform task.
- Telemetry MUST be redacted/minimized and should not retain raw page text by default.

Do not log whole WebSocket frames in production.

## 16. Health endpoints

Backend should expose:

```text
GET /healthz
GET /readyz
```

No application secrets or provider details in responses.

## 17. Development CORS/origin rules

WebSocket/HTTP origin handling must explicitly allow the development extension origin or local tooling. Do not use unrestricted `*` in production for authenticated endpoints.

Exact production authentication/origin scheme remains an open deployment decision.

## 18. Required tests

- Pydantic validation for every event type;
- protocol version rejection;
- task state ordering;
- only one pending action;
- canceled task rejects action result continuation;
- confirmation expiry;
- provider timeout;
- malformed provider tool call;
- reconnect to missing in-memory task;
- safe error serialization;
- secrets not present in logs.
