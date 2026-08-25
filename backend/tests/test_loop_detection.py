"""Loop detection, semantic hashing, and prompt framing tests (docs/04 §6/§15,
docs/08 §14)."""

from app.agent.context import compact_history
from app.agent.orchestrator import _is_repeated_failure, _loop_detected
from app.sessions.models import StepRecord
from app.telemetry.tracing import semantic_hash


def record(
    step: int, signature: str | None = None, error_code: str | None = "ACTION_FAILED"
) -> StepRecord:
    return StepRecord(
        step=step,
        action={"tool": "click_element", "args": {"element_id": 5}} if error_code else None,
        error_code=error_code,
        signature=signature,
        result_summary="attempt",
    )


def test_semantic_hash_ignores_volatile_fields() -> None:
    text_a = 'PAGE title="Shop" url="https://x/" snapshot="aaa" epoch=1\nMAIN @1'
    text_b = 'PAGE title="Shop" url="https://x/" snapshot="bbb" epoch=42\nMAIN @1'
    assert semantic_hash(text_a) == semantic_hash(text_b)
    assert semantic_hash('PAGE title="Other"') != semantic_hash(text_a)


def test_loop_detected_after_three_identical_failures() -> None:
    history = [record(1, "sig-a"), record(2, "sig-a"), record(3, "sig-a")]
    assert _loop_detected(history) is True


def test_no_loop_with_distinct_or_few_failures() -> None:
    assert _loop_detected([record(1, "sig-a"), record(2, "sig-b")]) is False
    assert _loop_detected([record(1, "sig-a"), record(2, "sig-a")]) is False
    ok_only = [record(1, "sig-a", error_code=None), record(2, "sig-a", error_code=None)]
    assert _loop_detected(ok_only) is False


def test_alternating_pair_detected_at_three_cycles() -> None:
    alternating = [
        record(1, "a"),
        record(2, "b"),
        record(3, "a"),
        record(4, "b"),
        record(5, "a"),
        record(6, "b"),
    ]
    assert _loop_detected(alternating) is True


def test_alternating_pair_not_detected_below_three_cycles() -> None:
    below = [record(1, "a"), record(2, "b"), record(3, "a"), record(4, "b")]
    assert _loop_detected(below) is False


def test_consecutive_repeated_failure_helper() -> None:
    history = [record(1, "sig-x"), record(2, "sig-x")]
    assert _is_repeated_failure(history, "sig-x") is True
    assert _is_repeated_failure(history, "sig-y") is False


def test_compact_history_keeps_last_eight_verbatim() -> None:
    many = [record(i, f"sig-{i}") for i in range(1, 13)]
    lines = compact_history(many)
    summary_lines = [line for line in lines if line.startswith("- (")]
    step_lines = [line for line in lines if line.startswith("- Step")]
    assert len(summary_lines) == 1
    assert len(step_lines) == 8
    # Oldest four steps are summarized away; the last eight remain.
    assert "- Step 5:" in step_lines[0]
    assert "- Step 12:" in step_lines[-1]
