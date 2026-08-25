"""Observation wire model (docs/05 §6). The full node graph never leaves the
extension; the backend sees the compact text plus actionable fingerprints."""

from pydantic import BaseModel, Field

from app.protocols.actions import ExpectedTarget


class SnapshotStats(BaseModel):
    node_count: int = Field(ge=0)
    actionable_count: int = Field(ge=0)
    truncated_nodes: int = Field(ge=0)
    snapshot_truncated: bool
    serialized_chars: int = Field(ge=0)


class ObservationSnapshot(BaseModel):
    document_id: str = Field(min_length=1)
    snapshot_id: str = Field(min_length=1)
    mutation_epoch: int = Field(ge=0)
    url: str
    origin: str = ""
    title: str = ""
    semantic_text: str
    # The wire-level target fingerprint; one shared definition with the action
    # contract so bindings round-trip without conversion.
    actionable_fingerprints: dict[str, ExpectedTarget] = Field(default_factory=dict)
    stats: SnapshotStats
