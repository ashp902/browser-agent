// Browser Agent extension service worker (docs/01 §5).
//
// Event router and privileged Chrome API boundary only. Service workers are
// unloaded when dormant, so this module holds no durable task state: only
// transient request routing (docs/01 §5.1, docs/00 §2.6).

import { localError, normalizeUnknownError, type LocalError } from '../shared/errors';
import {
  buildEnvelope,
  CONTENT_MESSAGE_TIMEOUT_MS,
  errorResponse,
  isPingContentResult,
  isRpcResponse,
  okResponse,
  PROTOCOL_VERSION,
  PANEL_TO_WORKER_TYPES,
  validateEmptyPayload,
  validateRpcEnvelope,
  type ActiveContextData,
  type LocalCapabilitiesData,
  type PingContentResult,
  type RpcEnvelope,
  type RpcResponse,
} from '../shared/messages';
import { isObservationData, type ObservationData } from '../shared/semantic-contracts';
import { classifyUrlSupport } from '../shared/urls';
import {
  isActionResult,
  isBrowserActionRequest,
  isPlainObject,
  verifyConfirmationToken,
  type ActionResult,
} from '../shared/action-protocol';

const CONTENT_SCRIPT_FILE = 'content-entry.js';

type Result<T> = { ok: true; data: T } | { ok: false; error: LocalError };

/** Internal signal: no content listener exists yet, so injection is required. */
interface NoReceiverError extends LocalError {
  noReceiver: true;
}

function isNoReceiver(error: LocalError): error is NoReceiverError {
  return (error as NoReceiverError).noReceiver === true;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function configureSidePanelOnInstall(): void {
  chrome.runtime.onInstalled.addListener(() => {
    void chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error: unknown) => console.warn('setPanelBehavior failed', error));
  });
}

// ---------------------------------------------------------------------------
// Active tab resolution
// ---------------------------------------------------------------------------

export async function getActiveTab(): Promise<Result<chrome.tabs.Tab>> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || tab.id === undefined || !tab.url) {
      return {
        ok: false,
        error: localError('NO_ACTIVE_TAB', 'No active tab is available in the current window.', true),
      };
    }
    return { ok: true, data: tab };
  } catch (error) {
    return { ok: false, error: normalizeUnknownError(error, 'Failed to resolve the active tab.') };
  }
}

// ---------------------------------------------------------------------------
// Content-runtime communication
// ---------------------------------------------------------------------------

/**
 * Sends a validated envelope to a tab's content runtime with a bounded wait.
 * Raw Chrome errors are normalized to the project taxonomy (docs/01 §15).
 */
export async function sendContentRequest<T>(
  tabId: number,
  envelope: RpcEnvelope<unknown>,
  timeoutMs: number = CONTENT_MESSAGE_TIMEOUT_MS,
): Promise<Result<T>> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('content request timed out')), timeoutMs);
  });
  try {
    const response: unknown = await Promise.race([chrome.tabs.sendMessage(tabId, envelope), timeout]);
    if (!isRpcResponse(response)) {
      return {
        ok: false,
        error: localError('RPC_VALIDATION_FAILED', 'Content runtime returned a malformed response.'),
      };
    }
    if (!response.ok) {
      return { ok: false, error: response.error };
    }
    return { ok: true, data: response.data as T };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/receiving end does not exist/i.test(message)) {
      const noReceiver: NoReceiverError = {
        ...localError('CONTENT_RUNTIME_UNAVAILABLE', 'Content runtime is not installed in this tab.', true),
        noReceiver: true,
      };
      return { ok: false, error: noReceiver };
    }
    if (/timed out/i.test(message)) {
      return { ok: false, error: localError('LOCAL_TIMEOUT', 'Content runtime did not respond in time.', true) };
    }
    if (/cannot access|permission|not allowed/i.test(message)) {
      return {
        ok: false,
        error: localError(
          'PERMISSION_REQUIRED',
          'The extension does not currently have access to this tab. Click the Browser Agent toolbar action on this tab to grant access.',
          true,
        ),
      };
    }
    if (/no tab with|tab was closed/i.test(message)) {
      return { ok: false, error: localError('NO_ACTIVE_TAB', 'The target tab is gone.', true) };
    }
    return { ok: false, error: normalizeUnknownError(error, 'Content request failed.') };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function pingContentRuntime(tabId: number): Promise<Result<PingContentResult>> {
  const result = await sendContentRequest<unknown>(tabId, buildEnvelope('PING_CONTENT_RUNTIME', {}));
  if (!result.ok) return result;
  if (!isPingContentResult(result.data)) {
    return {
      ok: false,
      error: localError('RPC_VALIDATION_FAILED', 'Content runtime ping response was malformed.'),
    };
  }
  return { ok: true, data: result.data };
}

/**
 * Ensures a live content runtime exists in the tab (docs/01 §6):
 * ping first, inject the bundled content script only when no receiver exists,
 * then ping again. Never silently fails: every exit is a typed result.
 */
export async function ensureContentRuntime(tabId: number): Promise<Result<PingContentResult>> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (error) {
    return { ok: false, error: normalizeUnknownError(error, 'The target tab is not available.') };
  }

  const support = classifyUrlSupport(tab.url, chrome.runtime.id);
  if (!support.supported) {
    return { ok: false, error: localError('UNSUPPORTED_URL', support.reason, false) };
  }

  const firstPing = await pingContentRuntime(tabId);
  if (firstPing.ok) return firstPing;
  if (!isNoReceiver(firstPing.error)) {
    return firstPing;
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/cannot access|permission|not allowed|file:\/\//i.test(message)) {
      return {
        ok: false,
        error: localError(
          'PERMISSION_REQUIRED',
          'The extension does not currently have access to this tab. Click the Browser Agent toolbar action on this tab to grant access.',
          true,
        ),
      };
    }
    return {
      ok: false,
      error: localError('CONTENT_RUNTIME_UNAVAILABLE', 'Content script could not be injected into this tab.', true),
    };
  }

  const secondPing = await pingContentRuntime(tabId);
  if (secondPing.ok) return secondPing;
  if (isNoReceiver(secondPing.error)) {
    return {
      ok: false,
      error: localError('CONTENT_RUNTIME_UNAVAILABLE', 'Content runtime did not start after injection.', true),
    };
  }
  return secondPing;
}

// ---------------------------------------------------------------------------
// Side-panel message routing
// ---------------------------------------------------------------------------

async function handleGetActiveContext(): Promise<Result<ActiveContextData>> {
  const tabResult = await getActiveTab();
  if (!tabResult.ok) return tabResult;
  const tab = tabResult.data;
  const tabId = tab.id as number;

  const runtime = await ensureContentRuntime(tabId);
  if (!runtime.ok) return runtime;

  return {
    ok: true,
    data: {
      tab: { tab_id: tabId, url: tab.url as string, title: tab.title ?? '' },
      content_runtime: { status: 'ready', document_id: runtime.data.document_id },
    },
  };
}

function handleGetLocalCapabilities(): Result<LocalCapabilitiesData> {
  return {
    ok: true,
    data: {
      extension_version: chrome.runtime.getManifest().version,
      protocol_version: PROTOCOL_VERSION,
    },
  };
}

/** Full semantic observation of the active tab (docs/02 §18, docs/05 §6). */
async function handleObserveActivePage(): Promise<Result<ObservationData>> {
  const tabResult = await getActiveTab();
  if (!tabResult.ok) return tabResult;
  const tabId = tabResult.data.id as number;

  const ensured = await ensureContentRuntime(tabId);
  if (!ensured.ok) return ensured;

  const observed = await sendContentRequest<unknown>(tabId, buildEnvelope('OBSERVE_PAGE', {}));
  if (!observed.ok) return observed;
  if (!isObservationData(observed.data)) {
    return {
      ok: false,
      error: localError('RPC_VALIDATION_FAILED', 'Observation response was malformed.'),
    };
  }
  return { ok: true, data: observed.data };
}

/**
 * Executes one action on the active tab (docs/05 §7 action_request path).
 * The caller (backend orchestrator or dev console) supplies the fully-bound
 * action request. Actions whose policy is REQUIRE_CONFIRMATION must carry a
 * valid binding token; the worker refuses to forward them otherwise
 * (docs/03 §20, docs/06 §9).
 */
async function handleExecuteActivePageAction(
  payload: unknown,
): Promise<Result<ActionResult>> {
  const container = isPlainObject(payload) ? payload : {};
  const action = container['action'];
  const policy = typeof container['policy'] === 'string' ? container['policy'] : undefined;
  if (!isBrowserActionRequest(action)) {
    return {
      ok: false,
      error: localError('RPC_VALIDATION_FAILED', 'payload.action must be a valid action request.'),
    };
  }
  if (policy === 'REQUIRE_CONFIRMATION') {
    const violation = verifyConfirmationToken(action.confirmation_token, action);
    if (violation !== null) {
      return {
        ok: false,
        error: localError('PERMISSION_REQUIRED', `Confirmation gate refused the action: ${violation}.`),
      };
    }
  }

  const tabResult = await getActiveTab();
  if (!tabResult.ok) return tabResult;
  const tabId = tabResult.data.id as number;

  const ensured = await ensureContentRuntime(tabId);
  if (!ensured.ok) return ensured;

  const executed = await sendContentRequest<unknown>(
    tabId,
    buildEnvelope('EXECUTE_ACTION', action),
  );
  if (!executed.ok) return executed;
  if (!isActionResult(executed.data)) {
    return {
      ok: false,
      error: localError('RPC_VALIDATION_FAILED', 'Action result was malformed.'),
    };
  }
  return { ok: true, data: executed.data };
}

type PanelMessageHandler = (payload: unknown) => Promise<Result<unknown>> | Result<unknown>;

/**
 * Handlers implemented in this build. All four protocol vocabulary types now
 * have handlers; payload validation happens inside each handler.
 */
const PANEL_HANDLERS: Record<string, PanelMessageHandler> = {
  GET_ACTIVE_CONTEXT: (payload) => {
    if (!validateEmptyPayload(payload)) return emptyPayloadError();
    return handleGetActiveContext();
  },
  GET_LOCAL_CAPABILITIES: (payload) => {
    if (!validateEmptyPayload(payload)) return emptyPayloadError();
    return handleGetLocalCapabilities();
  },
  OBSERVE_ACTIVE_PAGE: (payload) => {
    if (!validateEmptyPayload(payload)) return emptyPayloadError();
    return handleObserveActivePage();
  },
  EXECUTE_ACTIVE_PAGE_ACTION: (payload) => handleExecuteActivePageAction(payload),
};

function emptyPayloadError(): Result<never> {
  return {
    ok: false,
    error: localError('RPC_VALIDATION_FAILED', 'Payload must be an empty object for this message type.'),
  };
}

function isSidePanelSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  // Query string allowed: E2E runs pass ?backend= to pin the backend port.
  const senderPath = (sender.url ?? '').split('?')[0];
  return senderPath === chrome.runtime.getURL('sidepanel.html');
}

/**
 * Validates and dispatches one side-panel message. Never throws: every failure
 * is normalized into a typed RpcResponse (docs/01 §9, §15).
 */
export async function handlePanelMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<RpcResponse<unknown>> {
  if (typeof message === 'object' && message !== null && !isSidePanelSender(sender)) {
    const requestId =
      typeof (message as Record<string, unknown>).request_id === 'string'
        ? ((message as Record<string, unknown>).request_id as string)
        : 'unknown';
    return errorResponse(
      requestId,
      localError('RPC_VALIDATION_FAILED', 'Message sender is not the extension side panel.'),
    );
  }

  const validation = validateRpcEnvelope(message, PANEL_TO_WORKER_TYPES);
  if (!validation.ok) {
    const requestId =
      typeof message === 'object' && message !== null &&
      typeof (message as Record<string, unknown>).request_id === 'string'
        ? ((message as Record<string, unknown>).request_id as string)
        : 'unknown';
    return errorResponse(requestId, validation.error);
  }

  const { envelope } = validation;
  const handler = PANEL_HANDLERS[envelope.type];
  if (!handler) {
    return errorResponse(
      envelope.request_id,
      localError('RPC_VALIDATION_FAILED', 'Message type is not implemented in this build.'),
    );
  }

  try {
    const result = await handler(envelope.payload);
    return result.ok
      ? okResponse(envelope.request_id, result.data)
      : errorResponse(envelope.request_id, result.error);
  } catch (error) {
    return errorResponse(
      envelope.request_id,
      normalizeUnknownError(error, 'The extension failed to handle the request.'),
    );
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerServiceWorker(): void {
  configureSidePanelOnInstall();
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    void handlePanelMessage(message, sender).then(sendResponse);
    return true; // async sendResponse
  });
}

// Auto-register only inside a real extension service-worker context. Tests
// import this module with a mocked chrome global and call handlers directly.
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  registerServiceWorker();
}
