// Wire-facing semantic contracts shared across extension contexts
// (docs/02 §20, docs/05 §6 observation payload).
//
// These types cross the content-script boundary toward the service worker,
// side panel, and eventually the backend. The full node graph never does.

export interface SemanticFingerprint {
  role: string;
  normalized_name: string;
  tag_name: string;
  input_type?: string;
  href_origin?: string;
}

export interface SnapshotStats {
  node_count: number;
  actionable_count: number;
  truncated_nodes: number;
  snapshot_truncated: boolean;
  serialized_chars: number;
}

/** Observation data sent to the side panel / backend (docs/05 §6). */
export interface ObservationData {
  document_id: string;
  snapshot_id: string;
  mutation_epoch: number;
  url: string;
  origin: string;
  title: string;
  semantic_text: string;
  actionable_fingerprints: Record<number, SemanticFingerprint>;
  stats: SnapshotStats;
}

export function isObservationData(value: unknown): value is ObservationData {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.document_id === 'string' &&
    typeof c.snapshot_id === 'string' &&
    typeof c.mutation_epoch === 'number' &&
    typeof c.url === 'string' &&
    typeof c.origin === 'string' &&
    typeof c.title === 'string' &&
    typeof c.semantic_text === 'string' &&
    typeof c.actionable_fingerprints === 'object' &&
    c.actionable_fingerprints !== null &&
    typeof c.stats === 'object' &&
    c.stats !== null
  );
}
