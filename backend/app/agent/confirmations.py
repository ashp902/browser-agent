"""Confirmation objects and binding tokens (docs/06 §9, docs/03 §20).

Approval authorizes exactly one frozen action bound to task, action,
document, target fingerprint, and a short expiration. The token travels to the
extension inside action_request so the executor can re-verify the binding at
the last line of defense.

MVP limitation (documented): tokens are un-signed because no shared secret or
auth identity exists yet (docs/06 §12, OPEN-001). They are tamper-evident only
via binding-field equality with the request; production auth must revisit this.
"""

import base64
import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from app.protocols.actions import BrowserActionRequest

TOKEN_TTL_SECONDS_DEFAULT = 120


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def hash_object(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


@dataclass(slots=True)
class Confirmation:
    confirmation_id: UUID
    task_id: UUID
    action_id: str
    document_id: str
    element_id: int | None
    target_fingerprint_hash: str | None
    normalized_action_hash: str
    created_at: datetime
    expires_at: datetime


def create_confirmation(
    task_id: UUID,
    request: BrowserActionRequest,
    ttl_seconds: float = TOKEN_TTL_SECONDS_DEFAULT,
    now: datetime | None = None,
) -> Confirmation:
    moment = now or datetime.now(UTC)
    return Confirmation(
        confirmation_id=uuid4(),
        task_id=task_id,
        action_id=request.action_id,
        document_id=request.document_id,
        element_id=_element_id_of(request),
        target_fingerprint_hash=(
            hash_object(request.expected_target.model_dump())
            if request.expected_target is not None
            else None
        ),
        normalized_action_hash=hash_object(
            {
                "tool": request.tool,
                "args": request.args,
                "document_id": request.document_id,
                "observed_mutation_epoch": request.observed_mutation_epoch,
            }
        ),
        created_at=moment,
        expires_at=moment + timedelta(seconds=ttl_seconds),
    )


def _element_id_of(request: BrowserActionRequest) -> int | None:
    element_id = request.args.get("element_id")
    return element_id if isinstance(element_id, int) else None


def build_token(confirmation: Confirmation, request: BrowserActionRequest) -> str:
    # The token carries the raw fingerprint so the executor can verify by
    # structural equality without sharing a hash implementation.
    payload = {
        "action_id": confirmation.action_id,
        "document_id": confirmation.document_id,
        "element_id": confirmation.element_id,
        "expected_target": (
            request.expected_target.model_dump() if request.expected_target is not None else None
        ),
        "expires_at_ms": int(confirmation.expires_at.timestamp() * 1000),
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")


def decode_token(token: str) -> dict[str, Any] | None:
    if not isinstance(token, str) or token == "":
        return None
    try:
        padded = token + "=" * (-len(token) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("ascii"))
        data = json.loads(decoded)
        return data if isinstance(data, dict) else None
    except (ValueError, json.JSONDecodeError):
        return None


def verify_token(
    token: str, request: BrowserActionRequest, now_ms: int | None = None
) -> str | None:
    """Returns None when the binding is valid, otherwise a violation reason."""
    data = decode_token(token)
    if data is None:
        return "malformed confirmation token"
    expected_target = (
        request.expected_target.model_dump() if request.expected_target is not None else None
    )
    if not _targets_equal(data.get("expected_target"), expected_target):
        return "bound to a different target fingerprint"
    checks = [
        data.get("action_id") == request.action_id,
        data.get("document_id") == request.document_id,
        data.get("element_id") == _element_id_of(request),
    ]
    if not all(checks):
        return "confirmation is bound to a different action"
    expires_at_ms = data.get("expires_at_ms")
    current_ms = now_ms if now_ms is not None else int(datetime.now(UTC).timestamp() * 1000)
    if not isinstance(expires_at_ms, int) or current_ms > expires_at_ms:
        return "confirmation expired"
    return None


def _targets_equal(a: Any, b: Any) -> bool:
    """Structural equality with None-field normalization (both sides were
    produced by the same model_dump shape)."""
    if a is None or b is None:
        return a is None and b is None
    if not isinstance(a, dict) or not isinstance(b, dict):
        return False
    keys = set(a) | set(b)
    return all(a.get(key) == b.get(key) for key in keys)


def summary_for(request: BrowserActionRequest) -> str:
    """Deterministic user-facing summary of a frozen consequential action."""
    name = request.expected_target.normalized_name if request.expected_target else ""
    target = f" '{name}'" if name else ""
    return f"{request.tool}{target} on {request.document_id[:8]}"
