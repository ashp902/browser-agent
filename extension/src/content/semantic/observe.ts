// Observation pipeline (docs/02 §18).
//
// Captures document identity + epoch, builds the semantic model, applies the
// serialized-size policy, and derives the actionable fingerprint map sent to
// the backend. The full node graph stays inside the content runtime.

import { buildPageSnapshot, prunableNodeIds, withoutNodes } from './extractor';
import { serializeSnapshot } from './serializer';
import {
  MAX_SNAPSHOT_SERIALIZED_CHARS,
  type PageSnapshot,
  type SemanticFingerprint,
} from './types';
import type { ObservationData } from '../../shared/semantic-contracts';
import type { MutationTracker } from '../registry/mutation-tracker';
import type { ElementRegistry } from '../registry/element-registry';

export class DocumentChangedError extends Error {
  constructor() {
    super('The document changed while the snapshot was being captured.');
    this.name = 'DocumentChangedError';
  }
}

export interface ObserveContext {
  doc: Document;
  documentId: string;
  registry: ElementRegistry;
  tracker: MutationTracker;
  now?: () => number;
  newId?: () => string;
}

function collectActionableFingerprints(snapshot: PageSnapshot): Record<number, SemanticFingerprint> {
  const fingerprints: Record<number, SemanticFingerprint> = {};
  for (const node of Object.values(snapshot.nodes)) {
    if (node.element_id !== undefined && node.fingerprint) {
      fingerprints[node.element_id] = node.fingerprint;
    }
  }
  return fingerprints;
}

/** Applies docs/02 §16 size pressure: prune standalone paragraphs until the
 * serialization fits; never drop actionable controls or their ancestors. */
function applySizePolicy(snapshot: PageSnapshot): { snapshot: PageSnapshot; text: string } {
  let text = serializeSnapshot(snapshot);
  if (text.length <= MAX_SNAPSHOT_SERIALIZED_CHARS) {
    return { snapshot, text };
  }

  let current = snapshot;
  const prunable = prunableNodeIds(current);
  for (const nodeId of prunable) {
    current = withoutNodes(current, new Set([nodeId]));
    text = serializeSnapshot(current);
    if (text.length <= MAX_SNAPSHOT_SERIALIZED_CHARS) {
      return { snapshot: current, text };
    }
  }
  // Everything prunable is gone; report truncation honestly.
  return { snapshot: current, text };
}

function buildOnce(context: ObserveContext, now: () => number, newId: () => string): {
  snapshot: PageSnapshot;
  text: string;
} {
  const epochAtStart = context.tracker.currentEpoch;
  const snapshot = buildPageSnapshot(context.doc, {
    documentId: context.documentId,
    mutationEpoch: epochAtStart,
    registry: context.registry,
    snapshotId: newId(),
    capturedAtMs: now(),
  });
  // Extraction is synchronous, but guard anyway per docs/02 §18 step 7.
  if (context.tracker.currentEpoch !== epochAtStart) {
    throw new DocumentChangedError();
  }
  const sized = applySizePolicy(snapshot);
  return sized;
}

/**
 * Creates one observation (docs/02 §18). On document change during capture,
 * retries once; a second change raises DocumentChangedError for the caller to
 * surface as DOCUMENT_CHANGED.
 */
export function observePage(context: ObserveContext): ObservationData {
  const now = context.now ?? Date.now;
  const newId = context.newId ?? (() => crypto.randomUUID());

  let built: { snapshot: PageSnapshot; text: string };
  try {
    built = buildOnce(context, now, newId);
  } catch (error) {
    if (!(error instanceof DocumentChangedError)) throw error;
    built = buildOnce(context, now, newId);
  }

  const { snapshot, text } = built;
  return {
    document_id: snapshot.document_id,
    snapshot_id: snapshot.snapshot_id,
    mutation_epoch: snapshot.mutation_epoch,
    url: snapshot.url,
    origin: snapshot.origin,
    title: snapshot.title,
    semantic_text: text,
    actionable_fingerprints: collectActionableFingerprints(snapshot),
    stats: { ...snapshot.stats, serialized_chars: text.length },
  };
}
