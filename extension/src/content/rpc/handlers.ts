// Content-runtime RPC handlers (docs/01 §7-§9).
//
// Narrow validated surface only: PING_CONTENT_RUNTIME and OBSERVE_PAGE in M2.
// EXECUTE_ACTION arrives with the action executor milestone. No handler may
// ever evaluate page-provided code or expose privileged APIs.

import { errorResponse, okResponse, validateRpcEnvelope, WORKER_TO_CONTENT_TYPES } from '../../shared/messages';
import { localError } from '../../shared/errors';
import type { ActionResult, BrowserActionRequest } from '../../shared/action-protocol';
import type { PingContentResult, RpcResponse } from '../../shared/messages';
import { observePage, DocumentChangedError, type ObserveContext } from '../semantic/observe';
import { executeAction } from '../actions/executor';
import { validatePayload, validateActionRequestPayload } from './schemas';

// Observation payloads flow through RpcResponse<unknown> as
// shared/semantic-contracts.ObservationData; action results as
// shared/action-protocol.ActionResult.

/** Live per-document context. `document_id` is fixed for this document's
 * lifetime; url/title are read fresh on every request. */
export interface ContentRuntimeContext {
  document_id: string;
  url: string;
  title: string;
}

export type ContentContextProvider = () => ContentRuntimeContext;

/** Dependencies the handlers need from the content runtime instance. */
export interface ContentRuntime {
  observeContext: () => ObserveContext;
  executionContext: () => import('../actions/executor').ExecutionContext;
}

function pingResult(context: ContentRuntimeContext): PingContentResult {
  return {
    document_id: context.document_id,
    url: context.url,
    title: context.title,
  };
}

/**
 * Handles one validated worker->content message. Synchronous and total: every
 * outcome is a typed RpcResponse (docs/01 §8).
 */
export function handleContentMessage(
  message: unknown,
  currentContext: ContentContextProvider,
  runtime?: ContentRuntime,
): RpcResponse<unknown> {
  const requestIdOf = (): string =>
    typeof message === 'object' && message !== null &&
    typeof (message as Record<string, unknown>).request_id === 'string'
      ? ((message as Record<string, unknown>).request_id as string)
      : 'unknown';

  const validation = validateRpcEnvelope(message, WORKER_TO_CONTENT_TYPES);
  if (!validation.ok) {
    return errorResponse(requestIdOf(), validation.error);
  }

  const { envelope } = validation;
  const payloadError = validatePayload(envelope.type, envelope.payload);
  if (payloadError) {
    return errorResponse(envelope.request_id, payloadError);
  }

  switch (envelope.type) {
    case 'PING_CONTENT_RUNTIME':
      return okResponse(envelope.request_id, pingResult(currentContext()));

    case 'OBSERVE_PAGE': {
      if (!runtime) {
        return errorResponse(
          envelope.request_id,
          localError('RPC_VALIDATION_FAILED', 'Observation is not available in this runtime.'),
        );
      }
      try {
        const observation = observePage(runtime.observeContext());
        return okResponse(envelope.request_id, observation);
      } catch (error) {
        if (error instanceof DocumentChangedError) {
          return errorResponse(
            envelope.request_id,
            localError('DOCUMENT_CHANGED', 'The page changed during observation. Observe again.', true),
          );
        }
        return errorResponse(
          envelope.request_id,
          localError('INTERNAL_EXTENSION_ERROR', 'Semantic extraction failed.'),
        );
      }
    }

    case 'EXECUTE_ACTION': {
      // The action result (success OR failure) is the response data: transport
      // errors are reserved for delivery problems, not action outcomes.
      const requestError = validateActionRequestPayload(envelope.payload);
      if (requestError) {
        return errorResponse(envelope.request_id, requestError);
      }
      if (!runtime) {
        return errorResponse(
          envelope.request_id,
          localError('RPC_VALIDATION_FAILED', 'Actions are not available in this runtime.'),
        );
      }
      const result: ActionResult = executeAction(
        envelope.payload as BrowserActionRequest,
        runtime.executionContext(),
      );
      return okResponse(envelope.request_id, result);
    }

    default:
      return errorResponse(
        envelope.request_id,
        localError('RPC_VALIDATION_FAILED', 'Message type is not implemented by this content runtime build.'),
      );
  }
}
