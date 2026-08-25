# 09 - MVP Roadmap and Acceptance

Status: AUTHORITATIVE IMPLEMENTATION ORDER

## 1. Principle

Build the nervous system before the intelligence. Each milestone must pass its acceptance tests before later scope is pulled forward.

## 2. Milestone 0 - Repository skeleton

Deliver:

- `extension/`
- `backend/`
- `test-site/`
- `docs/`
- root README with local setup
- CI skeleton

No LLM integration yet.

Acceptance:

- extension build succeeds;
- backend starts;
- test site starts;
- lint/test commands exist;
- no forbidden permissions.

## 3. Milestone 1 - Extension nervous system

Implement:

- Manifest V3;
- side panel opens from action icon;
- service worker;
- `activeTab` + `scripting` injection;
- content runtime ping;
- typed local messaging;
- active-tab context display;
- document ID.

Acceptance:

- ordinary HTTPS/local page can be reached after user invocation;
- content runtime responds;
- reload creates new document ID;
- unsupported page returns typed error;
- service-worker restart does not break side-panel UI shell.

## 4. Milestone 2 - Semantic perception

Implement document 02 completely enough for reference fixtures:

- role mapping;
- naming;
- state extraction;
- visibility;
- hierarchy;
- repeated groups;
- registry IDs;
- compact serializer;
- mutation epoch;
- golden fixtures.

Side panel gets an `Inspect Page` development view showing semantic text.

Acceptance:

- all golden tests pass;
- product cards retain correct Buy association;
- table Edit association correct;
- hidden/password handling correct;
- semantic text stays under configured maximum for reference pages.

## 5. Milestone 3 - Deterministic action executor

Implement:

```text
click_element
set_text
select_option
set_checked
press_key
scroll_page
scroll_element
navigate_current_tab
go_back
```

Provide temporary developer controls in side panel to manually enter an element ID/tool so actions can be tested without LLM.

Acceptance:

- manual side-panel action can click a chosen repeated Buy button;
- stale target safely rejected;
- duplicate action ID not re-executed;
- form events work in reference site's React controls;
- sensitive fields refused;
- navigation scheme tests pass.

## 6. Milestone 4 - Backend protocol and mock agent

Implement:

- FastAPI WebSocket;
- event models;
- session state machine;
- side panel backend client;
- mock deterministic agent capable of scripted test actions.

Acceptance:

- end-to-end task traverses backend -> extension -> page -> backend without real LLM;
- cancellation works;
- disconnect produces safe stop;
- task trace generated.

## 7. Milestone 5 - LLM agent loop

Implement:

- provider interface;
- one selected provider adapter;
- tool schemas;
- orchestrator;
- system prompt;
- one-action enforcement;
- step limit;
- loop detection;
- re-observation.

Acceptance:

- at least 10 read/navigation tasks pass reference site at >= 90% over repeated eval runs;
- invalid tool calls never reach executor;
- model never acts on element ID absent from latest snapshot.

## 8. Milestone 6 - Safety gates

Implement:

- policy engine;
- confirmation flow;
- confirmation binding/expiry;
- manual password/secret flow;
- production logging redaction;
- prompt-injection fixtures.

Acceptance:

- checkout submit always requires confirmation;
- user denial prevents action;
- changed target invalidates approval;
- password value never reaches backend test spy;
- injected hostile page text cannot produce forbidden capability.

## 9. Milestone 7 - Full reference eval

Expand to 20+ tasks and reach document 08 acceptance target.

Acceptance:

- >=95% success on supported deterministic tasks over required run count;
- 0 safety invariant failures;
- traces identify all failures;
- build/release extension has no dev debug capture enabled.

## 10. Milestone 8 - Limited real-web alpha

Only after Milestone 7.

Add:

- selected public-site non-destructive tests;
- bug classification by semantic/executor/model layer;
- permission UX refinement.

Still no vision, voice, WebMCP dependency, or autonomous background tasks.

## 11. Future Milestone - WebMCP adapter

Use document 07 and re-verify Chrome standard/API before implementation.

## 12. Future Milestone - Layout projection / ASCII

Purpose: provide text-native spatial context when semantic hierarchy is insufficient.

This is intentionally parked. The semantic model remains source of truth.

## 13. Future Milestone - Vision fallback

Only after metrics show semantic + optional layout cannot solve important target sites. Vision is a fallback, not default perception.

## 14. Future Milestone - Voice

Voice is an I/O adapter on top of a reliable text agent. Do not change browser core for voice.

## 15. Future Milestone - Multi-tab/cross-origin agent

Requires a new permission/product decision, likely optional host permissions and a stronger tab/session model. Not a hidden extension of MVP.

## 16. What the coding agent must not do to "get ahead"

Do not:

- add vector DB;
- add RAG framework;
- add Redis/Postgres before session persistence requirement;
- add voice SDK;
- add screenshot support;
- add `chrome.debugger`;
- add `<all_urls>`;
- add arbitrary browser-eval tool;
- add LangChain/LangGraph or other agent framework unless explicitly approved;
- add Docker/Kubernetes complexity unless local setup requires it;
- add account/auth product flow;
- add business-side WebMCP SDK.

Simple code following these contracts is preferred.
