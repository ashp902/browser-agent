// TypeScript mirror of the backend wire protocol (docs/05).
//
// Kept structurally identical to app/protocols/events.py. Frames are versioned
// envelopes; unknown server types are surfaced as protocol errors rather than
// silently ignored.

import type { ActionResult, BrowserActionRequest } from './action-protocol';
import type { ObservationData } from './semantic-contracts';

export const WIRE_PROTOCOL_VERSION = 1 as const;

export interface WireEnvelope {
  protocol_version: typeof WIRE_PROTOCOL_VERSION;
  event_id: string;
  task_id: string | null;
  type: string;
  timestamp_ms: number;
  payload: unknown;
}

// ---------------------------------------------------------------------------
// Server -> client events (docs/05 §7)
// ---------------------------------------------------------------------------

export type ObservationReason =
  | 'initial'
  | 'after_action'
  | 'stale_target'
  | 'manual_resume'
  | 'final_verification';

export interface TaskCreatedEvent {
  type: 'task_created';
  payload: { task_id: string; status: string };
}

export interface RequestObservationEvent {
  type: 'request_observation';
  payload: { reason: ObservationReason };
}

export interface ActionRequestEvent {
  type: 'action_request';
  payload: { action: BrowserActionRequest; policy: string; confirmation_token?: string };
}

export interface StatusEvent {
  type: 'status';
  payload: { state: string; detail?: string };
}

export interface ManualActionRequestEvent {
  type: 'manual_action_request';
  payload: { reason: string; instruction: string };
}

export interface ConfirmationRequestEvent {
  type: 'confirmation_request';
  payload: {
    confirmation_id: string;
    action_id: string;
    title: string;
    summary: string;
    risk: string;
    expires_at_ms: number;
  };
}

export interface TaskCompletedEvent {
  type: 'task_completed';
  payload: {
    task_id: string;
    summary: string;
    metrics: Record<string, unknown>;
    trace?: Record<string, unknown>;
  };
}

export interface TaskFailedEvent {
  type: 'task_failed';
  payload: {
    task_id: string | null;
    code: string;
    message: string;
    trace?: Record<string, unknown>;
  };
}

export type ServerEvent =
  | TaskCreatedEvent
  | RequestObservationEvent
  | ActionRequestEvent
  | StatusEvent
  | ManualActionRequestEvent
  | ConfirmationRequestEvent
  | TaskCompletedEvent
  | TaskFailedEvent;

/** Parses one raw frame; throws on malformed envelopes/versions/types. */
export function parseServerFrame(raw: string): ServerEvent {
  let envelope: WireEnvelope;
  try {
    envelope = JSON.parse(raw) as WireEnvelope;
  } catch {
    throw new Error('Frame is not valid JSON.');
  }
  if (
    typeof envelope !== 'object' ||
    envelope === null ||
    envelope.protocol_version !== WIRE_PROTOCOL_VERSION ||
    typeof envelope.type !== 'string'
  ) {
    throw new Error('Unsupported frame or protocol version.');
  }
  return { type: envelope.type, payload: envelope.payload } as ServerEvent;
}

// ---------------------------------------------------------------------------
// Client -> server builders (docs/05 §6)
// ---------------------------------------------------------------------------

let clientEventCounter = 0;

function buildFrame(type: string, taskId: string | null, payload: unknown): string {
  clientEventCounter += 1;
  const envelope: WireEnvelope = {
    protocol_version: WIRE_PROTOCOL_VERSION,
    event_id: `${Date.now()}-${clientEventCounter}`,
    task_id: taskId,
    type,
    timestamp_ms: Date.now(),
    payload,
  };
  return JSON.stringify(envelope);
}

export function buildStartTaskFrame(
  goal: string,
  client: { extension_version: string; locale?: string },
): string {
  return buildFrame('start_task', null, { goal, client });
}

export function buildObservationFrame(taskId: string, observation: ObservationData): string {
  return buildFrame('observation', taskId, {
    snapshot: {
      document_id: observation.document_id,
      snapshot_id: observation.snapshot_id,
      mutation_epoch: observation.mutation_epoch,
      url: observation.url,
      origin: observation.origin,
      title: observation.title,
      semantic_text: observation.semantic_text,
      actionable_fingerprints: observation.actionable_fingerprints,
      stats: observation.stats,
    },
  });
}

export function buildActionResultFrame(taskId: string, result: ActionResult): string {
  return buildFrame('action_result', taskId, { result });
}

export function buildCancelTaskFrame(taskId: string): string {
  return buildFrame('cancel_task', taskId, {});
}

export function buildClientErrorFrame(code: string, message: string): string {
  return buildFrame('client_error', null, { code, message });
}

export function buildConfirmationResponseFrame(
  taskId: string,
  confirmationId: string,
  decision: 'approve' | 'deny',
): string {
  return buildFrame('confirmation_response', taskId, { confirmation_id: confirmationId, decision });
}

export function buildManualActionCompletedFrame(taskId: string): string {
  return buildFrame('manual_action_completed', taskId, {});
}
