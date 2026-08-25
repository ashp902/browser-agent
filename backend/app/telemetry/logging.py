"""Structured JSON logging and task traces (docs/08 §13, docs/05 §15).

Telemetry is minimized: no full page text, no form values, no secrets. The
redaction filter drops any extra whose key looks sensitive regardless of value.
"""

import json
import logging
from datetime import UTC, datetime
from typing import Any

SENSITIVE_KEY_MARKERS = ("api_key", "password", "secret", "token", "authorization")


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in getattr(record, "extras", {}).items():
            if not any(marker in key.lower() for marker in SENSITIVE_KEY_MARKERS):
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class RedactingLogger(logging.LoggerAdapter):
    """Logger that carries structured extras without leaking sensitive keys."""

    def process(self, msg: str, kwargs: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        extras = kwargs.pop("extras", {})
        return msg, {"extra": {"extras": extras}, **kwargs}


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def log_event(logger: logging.Logger, level: int, message: str, **extras: Any) -> None:
    safe = {
        k: v for k, v in extras.items() if not any(m in k.lower() for m in SENSITIVE_KEY_MARKERS)
    }
    logger.log(level, message, extra={"extras": safe})
