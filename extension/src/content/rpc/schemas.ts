// Payload validation for content-runtime messages (docs/01 §9).
//
// Every receiver validates message version, allowed type, and payload schema.
// Action requests are validated against the full BrowserActionRequest shape
// before the executor ever sees them.

import { localError, type LocalError } from '../../shared/errors';
import { validateEmptyPayload } from '../../shared/messages';
import { isBrowserActionRequest, validateExecuteActionPayload } from '../../shared/action-protocol';

export function validatePayload(type: string, payload: unknown): LocalError | undefined {
  switch (type) {
    case 'PING_CONTENT_RUNTIME':
    case 'OBSERVE_PAGE':
      if (!validateEmptyPayload(payload)) {
        return localError('RPC_VALIDATION_FAILED', 'Payload must be an empty object for this message type.');
      }
      return undefined;
    case 'EXECUTE_ACTION':
      return validateActionRequestPayload(payload);
    default:
      return localError('RPC_VALIDATION_FAILED', 'Unknown content message type.');
  }
}

/** Validates an EXECUTE_ACTION payload as a complete BrowserActionRequest. */
export function validateActionRequestPayload(payload: unknown): LocalError | undefined {
  if (!isBrowserActionRequest(payload)) {
    return localError('RPC_VALIDATION_FAILED', 'Malformed action request.');
  }
  return undefined;
}

// Re-exported for the service-worker side payload validation.
export { validateExecuteActionPayload };
