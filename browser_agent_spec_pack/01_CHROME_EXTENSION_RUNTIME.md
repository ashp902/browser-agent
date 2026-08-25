# 01 - Chrome Extension Runtime

Status: AUTHORITATIVE FOR MVP

## 1. Objective

Define exactly how the Manifest V3 extension is structured, how its runtime contexts communicate, which permissions it requests, and which responsibilities belong in each context.

## 2. Runtime contexts

The extension contains exactly three runtime roles for MVP:

1. Side panel extension page.
2. Manifest V3 service worker.
3. Content script in the active webpage.

No offscreen document is required for MVP.

### 2.1 Side panel

The side panel is the interactive client and task-session owner.

It MUST:

- render task input and transcript/status;
- create/cancel a task session;
- hold the WebSocket connection to backend while open;
- request observations/actions from the local extension runtime;
- display confirmation prompts;
- display local permission or manual-action blockers;
- survive ordinary navigation within tabs as allowed by Chrome.

It MUST NOT:

- contain provider API keys;
- parse arbitrary page DOM directly;
- execute page actions directly;
- store raw page snapshots indefinitely;
- assume the service worker remains alive.

Chrome's Side Panel API is selected because it provides a persistent extension UI alongside page content and is available in Manifest V3.

## 3. Manifest

The production manifest baseline MUST conceptually include:

```json
{
  "manifest_version": 3,
  "name": "Browser Agent",
  "version": "0.1.0",
  "permissions": [
    "activeTab",
    "scripting",
    "sidePanel",
    "storage"
  ],
  "host_permissions": [
    "https://<PRODUCTION_API_HOST>/*"
  ],
  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "action": {
    "default_title": "Open Browser Agent"
  }
}
```

Development builds MAY include `http://localhost:<port>/*` for the backend.

MVP MUST NOT include:

```text
<all_urls>
debugger
cookies
history
webRequest
webNavigation
downloads
tabCapture
microphone
```

unless a decision record is changed first.

## 4. Permission philosophy

Chrome recommends minimum permissions. The MVP uses `activeTab` so the user explicitly invokes the extension before it receives temporary access to the current origin.

Important limitation: `activeTab` access is revoked when navigation leaves the granted origin. The implementation MUST detect this and return `PERMISSION_REQUIRED` instead of silently failing.

### 4.1 Future optional host permissions

A later version MAY declare broad patterns under `optional_host_permissions`, then request a specific origin only after a clear user interaction. This is not implemented in Milestone 1-3.

## 5. Service worker

Chrome extension service workers are event-driven and may be unloaded when dormant. Therefore:

### MUST store durable/longer-lived state elsewhere

Do not keep task state solely in service-worker globals.

Permitted local service-worker memory:

- short-lived routing map from request ID to sender;
- transient injection-in-progress promise;
- current extension-version constants.

Task history belongs in side panel/backend. User preferences belong in `chrome.storage`.

### 5.1 Service worker responsibilities

Implement modules/functions for:

- `configureSidePanelOnInstall()`
- `getActiveTab()`
- `ensureContentRuntime(tabId)`
- `sendContentRequest(tabId, message)`
- message sender validation
- routing error normalization

The action icon SHOULD be configured to open/toggle the side panel through `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.

## 6. Content script injection

MVP uses programmatic injection through `chrome.scripting` rather than permanent static content-script host matches.

Flow:

1. User invokes extension, granting `activeTab`.
2. Side panel requests observation.
3. Service worker calls `ensureContentRuntime(tabId)`.
4. First attempt: send `PING_CONTENT_RUNTIME`.
5. If no receiver exists and permission is available, inject bundled `content-entry.js` with `chrome.scripting.executeScript`.
6. Send `PING_CONTENT_RUNTIME` again.
7. If successful, proceed.
8. Otherwise return typed local error.

Do not use a remote script URL. Manifest V3 Chrome Web Store policy requires extension executable code to be bundled with the extension rather than remotely hosted.

## 7. Content-script world

Content scripts run in an isolated world. This is desirable for the semantic parser and executor because page JavaScript cannot directly access the extension's local variables.

However, isolation does not make page-derived data trusted. A malicious page controls DOM content and may attempt to influence the agent through text.

The content script MUST:

- treat page text as data;
- validate every RPC request;
- expose no generic `eval` or `execute` entry point;
- avoid sending privileged extension secrets into the page;
- avoid trusting page-created messages as extension commands.

## 8. Extension-internal messaging

Use typed one-time request/response messages for MVP. Chrome supports `runtime.sendMessage`, `tabs.sendMessage`, and long-lived ports, but the local extension path does not need a port initially.

All messages MUST have:

```ts
interface RpcEnvelope<T> {
  protocol_version: 1;
  request_id: string;
  type: string;
  payload: T;
}
```

Responses MUST have:

```ts
type RpcResponse<T> =
  | { request_id: string; ok: true; data: T }
  | { request_id: string; ok: false; error: LocalError };
```

### 8.1 Allowed local message types

Side panel -> service worker:

```text
GET_ACTIVE_CONTEXT
OBSERVE_ACTIVE_PAGE
EXECUTE_ACTIVE_PAGE_ACTION
GET_LOCAL_CAPABILITIES
```

Service worker -> content script:

```text
PING_CONTENT_RUNTIME
OBSERVE_PAGE
EXECUTE_ACTION
```

No message may carry arbitrary JavaScript source.

## 9. Message validation

Every receiver MUST validate:

- message version;
- allowed `type`;
- payload schema;
- sender context when available;
- target tab binding;
- action ID uniqueness where relevant.

Chrome security guidance explicitly recommends treating messages from content scripts as potentially attacker-influenced and limiting privileged actions they can trigger.

## 10. User-interface states

The side panel state machine MUST include at least:

```text
IDLE
STARTING
OBSERVING
THINKING
ACTING
WAITING_CONFIRMATION
WAITING_MANUAL_ACTION
COMPLETED
FAILED
CANCELED
```

Illegal transitions MUST be rejected in development builds.

Examples:

- `IDLE -> STARTING` valid.
- `THINKING -> ACTING` valid.
- `ACTING -> OBSERVING` valid.
- `WAITING_CONFIRMATION -> ACTING` only after affirmative response.
- `COMPLETED -> ACTING` invalid.

## 11. Cancellation

The user MUST always have a visible Stop/Cancel control while a task is active.

Cancellation behavior:

1. Side panel marks local session canceled immediately.
2. It sends `cancel_task` to backend.
3. It ignores late backend action requests for the canceled task.
4. No new local action may execute after cancellation state is set.
5. In-flight synchronous DOM action cannot always be reversed; executor returns whatever result occurred.

## 12. Navigation behavior

For MVP:

- same-tab navigation is supported when permissions remain valid;
- cross-origin navigation may revoke `activeTab`;
- after a new document loads, content runtime must be re-established;
- `document_id` must change;
- old element IDs are invalid;
- agent receives a fresh observation before further element actions.

The extension MUST NOT try to bypass Chrome permission revocation.

## 13. Storage

Use `chrome.storage.local` for:

- user preferences;
- local install ID if later required for telemetry and only after privacy review;
- feature flags intended to survive restart;
- development settings that are not secrets.

Do not store provider API keys there.

Do not store passwords, payment card information, session cookies, or raw full-page histories.

## 14. Content Security Policy and code packaging

All extension executable JavaScript/WASM MUST be bundled locally. The extension MUST NOT download executable code and evaluate it.

React rendering MUST avoid unsafe HTML insertion for page-derived strings. Do not use `dangerouslySetInnerHTML` for model/page content. Display as escaped text.

## 15. Error taxonomy from extension runtime

```ts
type LocalErrorCode =
  | 'NO_ACTIVE_TAB'
  | 'UNSUPPORTED_URL'
  | 'PERMISSION_REQUIRED'
  | 'CONTENT_RUNTIME_UNAVAILABLE'
  | 'DOCUMENT_CHANGED'
  | 'RPC_VALIDATION_FAILED'
  | 'LOCAL_TIMEOUT'
  | 'ACTION_FAILED'
  | 'INTERNAL_EXTENSION_ERROR';
```

Every local error includes a safe human-readable message and optional retryability flag. Raw stack traces go to development logs, not to model context.

## 16. Unsupported URLs

MVP MUST detect and refuse unsupported browser pages such as:

```text
chrome://...
chrome-extension://... owned by other extensions
edge://...
about:...
```

The Chrome Web Store and protected browser pages may also reject content-script injection. Return a clear local error.

## 17. Definition of done

This component is complete for MVP when:

- action click opens side panel;
- side panel can identify active tab after user invocation;
- content script is injected on an ordinary HTTPS page;
- side panel can request a typed semantic observation;
- side panel can request a typed test action through the worker;
- navigation/reload produces a new `document_id`;
- cross-origin permission loss produces `PERMISSION_REQUIRED`;
- service-worker restart does not destroy an active task's backend/UI state;
- no disallowed manifest permission exists.

## 18. Official references

- Side Panel API: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Content scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Service workers: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers
- Messaging: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- Scripting API: https://developer.chrome.com/docs/extensions/reference/api/scripting
- activeTab: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
- Security guidance: https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure
- Remote hosted code: https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code
