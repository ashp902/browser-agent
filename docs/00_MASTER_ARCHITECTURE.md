# 00 - Master Architecture

Status: AUTHORITATIVE  
Version: 0.1.0  
Last verified against Chrome documentation: 2026-08-24

## 1. Product capability being built

The first system is a Chrome extension plus backend agent that lets a user express a goal in natural language while browsing a webpage. The system observes the current page semantically, exposes a small fixed action set to an LLM, executes exactly one action at a time, then observes again.

The core architectural loop is:

```text
USER GOAL
   |
   v
SIDE PANEL UI
   |
   v
AGENT BACKEND
   |
   | requests observation / proposes action
   v
EXTENSION RUNTIME
   |
   v
CONTENT SCRIPT
   |
   +--> semantic page extraction
   +--> element registry
   +--> action executor
   |
   v
WEBPAGE
   |
   v
NEW PAGE STATE
   |
   +----------------------> repeat until done
```

The system is not a screen-reading replacement. It is an intent-to-action browser agent. Accessibility is an important use case, but the architecture is general.

## 2. Architectural invariants

These rules are frozen for MVP.

### 2.1 The model never receives arbitrary browser power

The LLM MUST NOT be allowed to emit arbitrary JavaScript, CSS selectors, XPath, shell commands, Chrome DevTools Protocol commands, or arbitrary network requests.

The LLM receives a finite tool set defined by this project. Example MVP tools:

```text
observe_page
click_element
set_text
select_option
set_checked
press_key
scroll_page
scroll_element
navigate_current_tab
go_back
finish
```

Every tool call is schema-validated outside the model.

### 2.2 Observe after every state-changing action

The agent MUST NOT create a long script of clicks and assume success. The execution pattern is:

```text
observe -> choose one action -> execute -> observe -> verify -> continue
```

A later optimization MAY permit carefully defined read-only batching, but state-changing action batching is out of scope for MVP.

### 2.3 Semantic representation is the only MVP perception mode

The MVP page observation is generated from DOM structure, HTML semantics, selected ARIA information, control state, visible text, and structural grouping.

MVP MUST NOT send:

- screenshots to a vision model;
- a rasterized representation;
- an ASCII layout projection;
- full raw HTML;
- full CSS;
- page JavaScript source.

Layout-aware ASCII and vision are recorded as future perception adapters, not implementation requirements.

### 2.4 Relationships are preserved

The semantic page model MUST be hierarchical, not a flat list. Repeated buttons such as `Buy`, `Edit`, or `Delete` must remain associated with the containing semantic group, row, form section, list item, or structurally inferred repeated container.

### 2.5 The backend owns reasoning and policy orchestration

The Chrome extension owns browser observation and browser actuation. The backend owns:

- the LLM provider connection;
- task/session orchestration;
- tool selection loop;
- policy evaluation that does not require local-only browser state;
- confirmation requests;
- context management;
- agent traces and evaluation metadata.

LLM API credentials MUST NOT be embedded in the extension.

### 2.6 The side panel owns the interactive session

The Chrome side panel is the persistent user-facing extension page for MVP. It owns the live connection to the backend while a task is running.

The extension service worker is an event router and privileged Chrome API boundary. It MUST NOT be treated as durable in-memory session storage because Manifest V3 service workers can be unloaded when dormant.

### 2.7 Content scripts are untrusted-boundary code

Content scripts directly touch hostile webpages. They MUST expose only narrow, validated RPC handlers. They MUST NOT receive backend secrets, provider API keys, unrelated browsing history, or cross-origin private data.

### 2.8 Consequential actions require deterministic policy gates

The system MUST have a policy layer between model decision and browser execution. A model request does not itself authorize an action.

Actions that may purchase, submit, send, delete, cancel, transfer money, create a binding reservation, change authentication/security state, or produce an equivalent irreversible/consequential effect MUST request user confirmation before final execution.

### 2.9 WebMCP is an adapter, not the foundation

WebMCP is strategically important but remains experimental as of the specification date. The MVP MUST function without WebMCP. The browser-agent abstraction MUST permit a future WebMCP tool source without rewriting the orchestrator.

## 3. Major components

### 3.1 Side Panel UI

Responsibilities:

- accepts text task from the user;
- shows current task status;
- shows concise action narration;
- displays confirmation requests;
- lets the user cancel immediately;
- owns the live backend WebSocket;
- requests current-tab observations/actions through the extension message router.

The side panel does not parse pages and does not directly run the agent model.

### 3.2 Extension Service Worker

Responsibilities:

- handles extension lifecycle and toolbar behavior;
- opens/configures the side panel;
- identifies the active tab when requested;
- injects/ensures the content script using `chrome.scripting` when permissions allow;
- routes validated messages between side panel and content script;
- performs Chrome API operations that should not be delegated to content scripts;
- tracks lightweight tab/document routing metadata only.

It is not durable state storage.

### 3.3 Content Script

Responsibilities:

- runs in Chrome's isolated content-script world;
- reads the current document DOM;
- creates semantic snapshots;
- maintains the element registry for the current document;
- monitors relevant DOM changes;
- validates targets immediately before execution;
- executes constrained DOM-level actions;
- returns structured action results.

### 3.4 Semantic Extractor

Inputs:

- current DOM;
- computed visibility information;
- semantic/native HTML roles;
- explicit ARIA roles and selected states/properties;
- labels and text;
- local DOM ancestry.

Outputs:

- `PageSnapshot` object;
- compact LLM serialization derived from that object.

The LLM serialization is not the data model. The structured `PageSnapshot` is the source of truth.

### 3.5 Element Registry

A per-document registry maps opaque numeric `element_id` values to live DOM elements using a `WeakMap<Element, number>` plus reverse lookup storage for live entries.

The model never receives selectors. It acts on an `element_id` observed in a snapshot.

### 3.6 Action Executor

Receives a typed action request and performs local validation before touching the page.

Every action returns one of:

- success with structured details;
- `STALE_TARGET`;
- `TARGET_NOT_FOUND`;
- `TARGET_NOT_VISIBLE`;
- `TARGET_DISABLED`;
- `UNSUPPORTED_TARGET`;
- `INVALID_ARGUMENT`;
- `PERMISSION_REQUIRED`;
- `NAVIGATION_BLOCKED`;
- `ACTION_FAILED`.

Exceptions MUST NOT leak raw extension internals to the LLM.

### 3.7 Agent Backend

MVP stack decision:

- Python 3.12+;
- FastAPI;
- Pydantic v2 models for all wire contracts;
- WebSocket for the active task session;
- pluggable LLM adapter interface;
- in-memory session store permitted for local MVP, but session interfaces must be persistence-ready.

The backend MUST not depend on a particular LLM provider's tool-call object shape outside the provider adapter.

### 3.8 Agent Orchestrator

The orchestrator is deterministic code around the LLM. It controls:

- max steps;
- tool availability;
- page observation requests;
- action schema validation;
- policy checks;
- confirmation state;
- retries;
- cancellation;
- final verification;
- trace generation.

The LLM proposes; the orchestrator authorizes and sequences.

### 3.9 Policy Engine

MVP policy inputs include:

- action type;
- target semantic role/name;
- nearby/ancestor semantic context;
- current page origin;
- whether the action is read-only, mutating, or potentially consequential;
- any site-specific rule known to the system.

The policy result is one of:

```text
ALLOW
REQUIRE_CONFIRMATION
REQUIRE_MANUAL_USER_ACTION
DENY
```

## 4. Current-tab permission model

MVP uses Manifest V3 with:

```text
sidePanel
activeTab
scripting
storage
```

and a host permission for the project's own backend API endpoint.

`activeTab` is intentionally selected for the first milestone because it grants temporary access after a user gesture without requesting persistent access to all websites. Chrome revokes activeTab access when the user navigates to a different origin. Therefore cross-origin autonomous workflows are explicitly not an MVP guarantee.

Future versions MAY request optional host permissions per origin with explicit user consent. The project MUST NOT jump directly to `<all_urls>` without a written architecture-decision update.

## 5. Runtime data flow

### 5.1 Start task

1. User opens side panel through the extension action.
2. User enters a goal.
3. Side panel creates a backend task session.
4. Backend asks for an observation.
5. Side panel requests active-tab observation through extension messaging.
6. Service worker ensures the content script is present.
7. Content script creates `PageSnapshot`.
8. Snapshot is privacy-filtered and serialized.
9. Side panel sends observation to backend.

### 5.2 Agent action

1. Orchestrator provides goal + allowed tools + latest semantic observation to LLM adapter.
2. LLM proposes exactly one tool call or `finish`.
3. Orchestrator validates schema.
4. Policy engine evaluates the request.
5. If confirmation is required, backend sends confirmation request and pauses.
6. Otherwise action request is sent to extension.
7. Content script revalidates the target.
8. Executor acts.
9. Executor returns structured result.
10. Backend requests a fresh observation.
11. Loop continues.

### 5.3 Completion

The orchestrator MUST only return final success after it has evidence from a recent observation or a deterministic action result supporting completion.

The model saying "done" is not sufficient evidence.

## 6. Page and element identity

Three distinct identities exist:

### 6.1 `tab_id`

Chrome tab identifier. Owned by extension runtime. Never trusted from backend without binding to the local active session.

### 6.2 `document_id`

Random UUID created by content script at document initialization. It changes after reload or navigation that creates a new document.

### 6.3 `element_id`

Monotonic integer assigned to a DOM `Element` within a document. It is opaque to the model.

Snapshots also include `mutation_epoch`, a monotonically increasing local counter representing meaningful semantic DOM changes.

An action includes:

```json
{
  "document_id": "...",
  "observed_mutation_epoch": 42,
  "element_id": 103
}
```

The executor MUST NOT reject solely because unrelated DOM content mutated. Instead it revalidates the target's identity and expected semantic fingerprint. Details are defined in document 03.

## 7. Page representation strategy

The source-of-truth snapshot is a tree/graph-like structure containing:

- page metadata;
- landmark/structural containers;
- meaningful groups;
- interactive controls;
- headings;
- concise visible text necessary to understand controls/content;
- tables/rows/cells;
- lists/list items;
- labeled images only when their alt/name contributes semantic information;
- control state;
- parent-child relationships.

The model-facing representation is compact text, for example:

```text
PAGE title="Search Results" url="https://shop.example/search?q=shoe"

REGION @10 "Results"
  GROUP @100
    H2 "Nike Pegasus 42"
    TEXT "$120"
    SELECT @102 "Size" value="10"
    BUTTON @103 "Buy"

  GROUP @200
    H2 "Adidas Ultraboost"
    TEXT "$140"
    BUTTON @203 "Buy"
```

This representation preserves the association between repeated controls and their group while avoiding raw HTML.

## 8. Explicit MVP exclusions

The implementation agent MUST NOT add these unless the decision register is amended:

- speech input/output;
- microphone permissions;
- screenshots;
- vision-model calls;
- ASCII page rendering;
- `chrome.debugger` permission;
- direct CDP integration;
- WebMCP as a required runtime path;
- multi-tab planning;
- background autonomous jobs;
- file uploads;
- downloads management;
- cookies API;
- history API;
- password entry;
- payment-card entry;
- browser credential-store access;
- arbitrary JavaScript execution;
- arbitrary selector/XPath execution from the model;
- remote hosted extension code.

## 9. Technology choices

### Extension

- TypeScript
- React
- Vite
- Manifest V3
- Chrome Side Panel API
- `chrome.runtime` messaging
- `chrome.scripting`
- `chrome.storage`

### Backend

- Python 3.12+
- FastAPI
- Pydantic v2
- WebSockets
- provider-neutral LLM adapter
- structured logging

### Testing

- Vitest for TypeScript unit tests
- pytest for backend tests
- Playwright with Chromium persistent context for extension end-to-end tests
- deterministic local reference site

These are architecture decisions, not suggestions.

## 10. Repository target layout

```text
browser-agent/
  docs/                         # this specification pack

  extension/
    manifest.json
    src/
      background/
        service-worker.ts
      sidepanel/
        App.tsx
        components/
        state/
        backend-client.ts
      content/
        entry.ts
        semantic/
          extractor.ts
          roles.ts
          accessible-name.ts
          grouping.ts
          serializer.ts
          visibility.ts
          types.ts
        registry/
          element-registry.ts
          mutation-tracker.ts
        actions/
          executor.ts
          click.ts
          text.ts
          select.ts
          check.ts
          keyboard.ts
          scroll.ts
          navigation.ts
        rpc/
          handlers.ts
          schemas.ts
      shared/
        messages.ts
        errors.ts
        ids.ts

  backend/
    app/
      main.py
      settings.py
      api/
        websocket.py
      agent/
        orchestrator.py
        prompts.py
        tool_catalog.py
        context.py
      providers/
        base.py
        selected_provider.py
      policy/
        engine.py
        rules.py
      protocols/
        events.py
        actions.py
        observations.py
      sessions/
        store.py
        models.py
      telemetry/
        logging.py
        tracing.py
    tests/

  test-site/
    ...
```

The implementing agent MAY create additional files inside these boundaries when mechanically necessary, but MUST NOT reorganize major component ownership without updating the decision register.

## 11. Reliability philosophy

The project prefers deterministic software over model reasoning whenever the problem can be expressed deterministically.

Examples:

- Schema validation: deterministic.
- Element target validation: deterministic.
- Permission checks: deterministic.
- Consequential-action gating: deterministic where rules are known.
- DOM extraction: deterministic.
- Whether `button @103` should be chosen for the user's ambiguous natural-language goal: model reasoning.

The model is used for intent interpretation and choosing among allowed capabilities, not as a substitute for basic software engineering.

## 12. References

Verified official references at specification freeze:

- Chrome Side Panel API: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Chrome content scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome extension service workers: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers
- Chrome extension message passing: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- Chrome scripting API: https://developer.chrome.com/docs/extensions/reference/api/scripting
- Chrome activeTab permission: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
- Chrome extension security guidance: https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure
- WAI-ARIA 1.2: https://www.w3.org/TR/wai-aria-1.2/
- Accessible Name and Description Computation: https://www.w3.org/TR/accname-1.2/
- Chrome WebMCP: https://developer.chrome.com/docs/ai/webmcp
- CDP WebMCP domain: https://chromedevtools.github.io/devtools-protocol/tot/WebMCP/
