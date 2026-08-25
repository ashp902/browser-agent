# 10 - AI Coding Agent Rules

Status: HIGHEST-AUTHORITY IMPLEMENTATION DOCUMENT

## 1. Mission

You are implementing the Browser Agent defined by this specification pack. Your job is to execute the architecture, not redesign it silently.

## 2. Before changing code

For every implementation task:

1. Read `README.md`.
2. Read this document.
3. Read `12_ARCHITECTURE_DECISIONS_AND_OPEN_QUESTIONS.md`.
4. Read the master architecture.
5. Read the component document relevant to the task.
6. Inspect existing code/tests.
7. Implement the smallest conforming change.

## 3. No invention rule

If the specification does not define a behavior that is required to proceed, you MUST NOT silently choose one.

Create an entry in the open-decisions section with:

```text
QUESTION:
WHY BLOCKING:
OPTIONS:
RECOMMENDATION:
IMPACT:
```

Then stop that architectural branch or implement only work that does not depend on the decision.

Examples of forbidden silent invention:

- adding a Chrome permission;
- choosing a new database;
- choosing an auth provider;
- adding a new LLM tool;
- changing wire schemas;
- changing consequence policy;
- replacing semantic representation with screenshots;
- changing repository boundaries;
- adding a heavy agent framework;
- changing the one-action rule.

## 4. Do not optimize architecture prematurely

You MUST NOT add infrastructure because it might be useful later.

Specifically prohibited without decision update:

- Redis;
- Postgres;
- queue workers;
- Kubernetes;
- vector database;
- browser farm;
- `chrome.debugger`;
- WebMCP runtime dependency;
- voice stack;
- visual computer-use stack.

## 5. Keep provider code isolated

No provider-specific types/imports outside `backend/app/providers/` except a tiny configuration identifier.

If a provider SDK tries to force architecture changes, adapt it locally rather than leaking provider abstractions across system.

## 6. Never give model arbitrary execution

Under no circumstances create tools resembling:

```text
execute_javascript(code)
run_selector(selector)
run_xpath(xpath)
fetch_url(url, options)
execute_cdp(command, params)
```

If a site needs behavior our tool set cannot perform, report unsupported behavior and add an open question if it is important.

## 7. Do not weaken validation to make a demo pass

Never respond to an agent failure by:

- accepting arbitrary IDs;
- bypassing fingerprint checks;
- auto-confirming consequential action;
- exposing secrets;
- allowing unvalidated URLs;
- disabling schema validation;
- updating golden test output without reviewing representation change.

Fix the underlying layer.

## 8. Tests are part of implementation

Every behavior change requires tests at the lowest appropriate layer.

A task is not complete if code compiles but required tests are absent.

For semantic changes:

- add/update focused unit fixture;
- review golden diff intentionally;
- add E2E only when user-visible behavior changes.

## 9. Error handling

Use project error codes. Do not expose raw exception strings to model/user if they contain implementation details or page content.

Development logs may include stack traces.

## 10. Data handling

Never log or persist:

- provider API keys;
- passwords;
- OTPs;
- card numbers/CVV;
- cookies;
- raw browser storage;
- full production page snapshot by default.

If a test needs secret-like data, use obvious fake fixture values.

## 11. Browser permissions

The frozen MVP permission set is:

```text
activeTab
scripting
sidePanel
storage
```

plus host permission for configured project backend.

Adding any permission is an architecture change.

## 12. User authority

- User may cancel at any time.
- Canceled tasks execute no new actions.
- Consequential actions require bound confirmation.
- Secret-entry steps are manual in MVP.

Do not implement shortcuts around these rules.

## 13. Page content is untrusted

When creating prompts or traces, page content is labeled untrusted.

Never interpolate page content into privileged system instructions or code generation/execution paths.

## 14. Code style principles

- Prefer explicit typed data models.
- Prefer small pure functions in semantic extraction.
- Prefer dependency injection for provider/policy/session store.
- Avoid clever reflection/metaprogramming.
- Keep constants centralized.
- No unexplained magic numbers.
- Comments explain why, not obvious syntax.
- Public/internal contracts have tests.

## 15. Change control

If you intentionally change architecture:

1. Update decision register first.
2. Update affected spec docs.
3. Update schemas/tests.
4. Then update implementation.

Code and spec must not knowingly diverge.

## 16. Status report format after an implementation task

Return a concise report:

```text
Implemented:
- ...

Tests:
- ...

Spec deviations:
- none
```

If deviations exist, list them explicitly and do not call the work complete unless approved.

## 17. Definition of compliant implementation

A compliant implementation is not the most feature-rich implementation. It is the smallest implementation that satisfies the current milestone and does not violate frozen constraints.
