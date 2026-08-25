// Browser Agent content-script entry (docs/01 §6-§7).
//
// Runs in Chrome's isolated world. Exposes only narrow, validated RPC handlers
// (rpc/handlers.ts). Page-derived data is always treated as untrusted; no
// generic eval/execute entry point exists here or may ever be added
// (docs/10 §6).

import { localError } from '../shared/errors';
import type { RpcResponse } from '../shared/messages';
import { newDocumentId } from '../shared/ids';
import { ElementRegistry } from './registry/element-registry';
import { MutationTracker } from './registry/mutation-tracker';
import { IdempotencyCache } from './actions/executor';
import { handleContentMessage, type ContentRuntime, type ContentRuntimeContext } from './rpc/handlers';

export function registerContentRuntime(): void {
  // Created once per document; a reload/navigation creates a new document and
  // therefore a new ID (docs/00 §6.2, docs/01 §12).
  const documentId = newDocumentId();
  const registry = new ElementRegistry();
  const tracker = new MutationTracker();
  tracker.start(document);
  const idempotency = new IdempotencyCache();

  const currentContext: () => ContentRuntimeContext = () => ({
    document_id: documentId,
    url: location.href,
    title: document.title,
  });

  const runtime: ContentRuntime = {
    observeContext: () => ({
      doc: document,
      documentId,
      registry,
      tracker,
    }),
    executionContext: () => ({
      doc: document,
      documentId,
      registry,
      tracker,
      idempotency,
    }),
  };

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    // Only our own service worker may drive this runtime. Messages bearing a
    // sender tab come from another content script and are ignored (docs/01 §9).
    if (sender.id !== chrome.runtime.id || sender.tab !== undefined) {
      return false;
    }
    let response: RpcResponse<unknown>;
    try {
      response = handleContentMessage(message, currentContext, runtime);
    } catch {
      response = {
        request_id:
          typeof message === 'object' && message !== null &&
          typeof (message as Record<string, unknown>).request_id === 'string'
            ? ((message as Record<string, unknown>).request_id as string)
            : 'unknown',
        ok: false,
        error: localError('INTERNAL_EXTENSION_ERROR', 'The content runtime failed to handle the request.'),
      };
    }
    sendResponse(response);
    return false;
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  registerContentRuntime();
}
