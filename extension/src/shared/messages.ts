// Typed local messaging contracts (docs/01 §8-§9).
//
// All extension-internal messages use a versioned envelope. Every receiver
// validates version, allowed type, and payload shape before acting. No message
// may carry arbitrary JavaScript source, selectors, or DOM handles.

import { localError, type LocalError } from './errors';
import { newRequestId } from './ids';

export const PROTOCOL_VERSION = 1 as const;

// Transport-level timeout for service-worker -> content-script requests. This
// only detects a dead/hung receiver; DOM-level action budgets are defined by
// the action executor (docs/03 §19).
export const CONTENT_MESSAGE_TIMEOUT_MS = 5000;

export type PanelToWorkerMessageType =
  | 'GET_ACTIVE_CONTEXT'
  | 'OBSERVE_ACTIVE_PAGE'
  | 'EXECUTE_ACTIVE_PAGE_ACTION'
  | 'GET_LOCAL_CAPABILITIES';

export type WorkerToContentMessageType = 'PING_CONTENT_RUNTIME' | 'OBSERVE_PAGE' | 'EXECUTE_ACTION';

export type LocalMessageType = PanelToWorkerMessageType | WorkerToContentMessageType;

export const PANEL_TO_WORKER_TYPES: readonly PanelToWorkerMessageType[] = [
  'GET_ACTIVE_CONTEXT',
  'OBSERVE_ACTIVE_PAGE',
  'EXECUTE_ACTIVE_PAGE_ACTION',
  'GET_LOCAL_CAPABILITIES',
];

export const WORKER_TO_CONTENT_TYPES: readonly WorkerToContentMessageType[] = [
  'PING_CONTENT_RUNTIME',
  'OBSERVE_PAGE',
  'EXECUTE_ACTION',
];

export interface RpcEnvelope<T> {
  protocol_version: typeof PROTOCOL_VERSION;
  request_id: string;
  type: string;
  payload: T;
}

export type RpcResponse<T> =
  | { request_id: string; ok: true; data: T }
  | { request_id: string; ok: false; error: LocalError };

// ---------------------------------------------------------------------------
// Payloads implemented in Milestone 1
// ---------------------------------------------------------------------------

export interface ActiveTabInfo {
  tab_id: number;
  url: string;
  title: string;
}

export interface ContentRuntimeStatus {
  status: 'ready';
  document_id: string;
}

/** Response data for GET_ACTIVE_CONTEXT. */
export interface ActiveContextData {
  tab: ActiveTabInfo;
  content_runtime: ContentRuntimeStatus;
}

/** Response data for GET_LOCAL_CAPABILITIES. */
export interface LocalCapabilitiesData {
  extension_version: string;
  protocol_version: typeof PROTOCOL_VERSION;
}

/** Response data for PING_CONTENT_RUNTIME. */
export interface PingContentResult {
  document_id: string;
  url: string;
  title: string;
}

// ---------------------------------------------------------------------------
// Envelope construction and validation
// ---------------------------------------------------------------------------

export function buildEnvelope<T>(type: LocalMessageType, payload: T): RpcEnvelope<T> {
  return {
    protocol_version: PROTOCOL_VERSION,
    request_id: newRequestId(),
    type,
    payload,
  };
}

export function okResponse<T>(requestId: string, data: T): RpcResponse<T> {
  return { request_id: requestId, ok: true, data };
}

export function errorResponse(requestId: string, error: LocalError): RpcResponse<never> {
  return { request_id: requestId, ok: false, error };
}

export type EnvelopeValidation =
  | { ok: true; envelope: RpcEnvelope<unknown> }
  | { ok: false; error: LocalError };

export function validateRpcEnvelope(
  message: unknown,
  allowedTypes: readonly string[],
): EnvelopeValidation {
  if (typeof message !== 'object' || message === null) {
    return {
      ok: false,
      error: localError('RPC_VALIDATION_FAILED', 'Message is not an object.'),
    };
  }
  const candidate = message as Record<string, unknown>;
  const requestId = typeof candidate.request_id === 'string' ? candidate.request_id : 'unknown';

  if (candidate.protocol_version !== PROTOCOL_VERSION) {
    return {
      ok: false,
      error: localError('RPC_VALIDATION_FAILED', 'Unsupported protocol version.'),
    };
  }
  if (typeof candidate.request_id !== 'string' || candidate.request_id.length === 0) {
    return {
      ok: false,
      error: localError('RPC_VALIDATION_FAILED', 'Missing request_id.'),
    };
  }
  if (typeof candidate.type !== 'string' || !allowedTypes.includes(candidate.type)) {
    return {
      ok: false,
      error: localError('RPC_VALIDATION_FAILED', 'Unknown message type.', false),
    };
  }
  if (!('payload' in candidate)) {
    return {
      ok: false,
      error: localError('RPC_VALIDATION_FAILED', 'Missing payload.'),
    };
  }
  return { ok: true, envelope: { ...(candidate as unknown as RpcEnvelope<unknown>), request_id: requestId } };
}

/** Validates that a payload is a plain empty object (for parameterless messages). */
export function validateEmptyPayload(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    !Array.isArray(payload) &&
    Object.keys(payload).length === 0
  );
}

export function isRpcResponse(value: unknown): value is RpcResponse<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.request_id !== 'string') return false;
  if (candidate.ok === true) return 'data' in candidate;
  if (candidate.ok === false) {
    const error = candidate.error;
    return (
      typeof error === 'object' &&
      error !== null &&
      typeof (error as Record<string, unknown>).code === 'string' &&
      typeof (error as Record<string, unknown>).message === 'string'
    );
  }
  return false;
}

/** Type guard refinement for PingContentResult payloads. */
export function isPingContentResult(value: unknown): value is PingContentResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.document_id === 'string' &&
    typeof candidate.url === 'string' &&
    typeof candidate.title === 'string'
  );
}
