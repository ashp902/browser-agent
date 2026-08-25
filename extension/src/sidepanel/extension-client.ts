// Thin typed client for side-panel -> service-worker messaging (docs/01 §8).

import {
  buildEnvelope,
  isRpcResponse,
  type ActiveContextData,
  type LocalCapabilitiesData,
  type PanelToWorkerMessageType,
} from '../shared/messages';
import type { ObservationData } from '../shared/semantic-contracts';
import type { ActionResult, BrowserActionRequest, BrowserToolName } from '../shared/action-protocol';
import { localError, type LocalError } from '../shared/errors';

export type LocalCallResult<T> = { ok: true; data: T } | { ok: false; error: LocalError };

async function sendToWorker<T>(type: PanelToWorkerMessageType, payload: unknown): Promise<LocalCallResult<T>> {
  const envelope = buildEnvelope(type, payload);
  try {
    const response: unknown = await chrome.runtime.sendMessage(envelope);
    if (!isRpcResponse(response)) {
      return {
        ok: false,
        error: localError('RPC_VALIDATION_FAILED', 'Service worker returned a malformed response.'),
      };
    }
    return response.ok ? { ok: true, data: response.data as T } : { ok: false, error: response.error };
  } catch {
    return {
      ok: false,
      error: localError('INTERNAL_EXTENSION_ERROR', 'Could not reach the extension service worker.', true),
    };
  }
}

export function getActiveContext(): Promise<LocalCallResult<ActiveContextData>> {
  return sendToWorker<ActiveContextData>('GET_ACTIVE_CONTEXT', {});
}

export function getLocalCapabilities(): Promise<LocalCallResult<LocalCapabilitiesData>> {
  return sendToWorker<LocalCapabilitiesData>('GET_LOCAL_CAPABILITIES', {});
}

export function observeActivePage(): Promise<LocalCallResult<ObservationData>> {
  return sendToWorker<ObservationData>('OBSERVE_ACTIVE_PAGE', {});
}

/**
 * Forwards a fully-bound action request to the active tab. The request must be
 * built against a recent observation (document_id, epoch, fingerprint).
 */
export function executeActivePageAction(
  action: BrowserActionRequest,
  policy?: string,
  confirmationToken?: string,
): Promise<LocalCallResult<ActionResult>> {
  return sendToWorker<ActionResult>('EXECUTE_ACTIVE_PAGE_ACTION', {
    action,
    ...(policy === undefined ? {} : { policy }),
    ...(confirmationToken === undefined ? {} : { confirmation_token: confirmationToken }),
  });
}

/** Convenience for callers building a bound request from an observation. */
export function buildBoundAction(
  observation: ObservationData,
  tool: BrowserToolName,
  args: Record<string, unknown>,
): BrowserActionRequest {
  const elementId = typeof args['element_id'] === 'number' ? args['element_id'] : undefined;
  const expectedTarget =
    elementId !== undefined ? observation.actionable_fingerprints[elementId] : undefined;
  return {
    protocol_version: 1,
    action_id: crypto.randomUUID(),
    document_id: observation.document_id,
    observed_mutation_epoch: observation.mutation_epoch,
    tool,
    args,
    ...(expectedTarget !== undefined ? { expected_target: expectedTarget } : {}),
  };
}
