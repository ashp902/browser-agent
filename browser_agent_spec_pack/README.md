# Browser Agent Engineering Specification Pack

Status: AUTHORITATIVE FOR MVP IMPLEMENTATION  
Version: 0.1.0  
Specification freeze date: 2026-08-24  
Working name: Browser Agent (placeholder only; this is not a product-name decision)

## Purpose

This directory is the implementation bible for the first version of a Chrome browser agent that accepts a natural-language task, observes the current webpage through a compact semantic representation, chooses one constrained browser action at a time, executes that action through a Chrome extension, re-observes the page, and continues until the task is complete or the user must intervene.

These documents are written so an AI coding agent can implement the system without making hidden architectural decisions. The implementation agent MUST follow the decisions and contracts here. If a required behavior is not specified, it MUST record an open decision rather than silently choosing an approach.

## Normative words

The words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are normative:

- MUST / MUST NOT: required for conformance with this specification.
- SHOULD / SHOULD NOT: default rule; deviation requires an explicit documented reason.
- MAY: optional and may be deferred.

## Document priority

If two documents appear to conflict, use this order of authority:

1. `10_AI_CODING_AGENT_RULES.md`
2. `12_ARCHITECTURE_DECISIONS_AND_OPEN_QUESTIONS.md`
3. `00_MASTER_ARCHITECTURE.md`
4. Component specifications `01` through `09` and `11`
5. Examples inside a document

An example never overrides a normative rule.

## Documents

- `00_MASTER_ARCHITECTURE.md` - system boundaries, components, data flow, MVP scope, and architectural invariants.
- `01_CHROME_EXTENSION_RUNTIME.md` - Manifest V3 extension, side panel, service worker, content scripts, permissions, messaging, lifecycle.
- `02_SEMANTIC_PAGE_MODEL.md` - DOM-to-semantic conversion, node schema, grouping, labels, compact serialization, snapshot lifecycle.
- `03_ELEMENT_REGISTRY_AND_ACTION_EXECUTOR.md` - target identity, stale-target validation, browser action contracts, execution behavior, failure modes.
- `04_AGENT_ORCHESTRATOR.md` - observe/reason/act/verify loop, LLM interface, tool-selection rules, stopping conditions, context management.
- `05_BACKEND_AND_WIRE_PROTOCOL.md` - FastAPI backend responsibilities, WebSocket protocol, event envelopes, session state, error contracts.
- `06_SECURITY_SAFETY_PRIVACY.md` - trust boundaries, prompt injection, confirmations, sensitive fields, logging, secrets, Chrome permission strategy.
- `07_WEBMCP_FUTURE_ADAPTER.md` - WebMCP position, verified current Chrome status, adapter boundary, and explicit deferral rules.
- `08_TESTING_EVALS_OBSERVABILITY.md` - unit/integration/e2e tests, golden semantic fixtures, task evals, metrics, traces, regression gates.
- `09_MVP_ROADMAP_AND_ACCEPTANCE.md` - implementation sequence, definition of done, milestone acceptance tests, what must not be pulled forward.
- `10_AI_CODING_AGENT_RULES.md` - exact operating rules for the AI coding agent implementing this system.
- `11_REFERENCE_TEST_SITE_SPEC.md` - deterministic ecommerce-style fixture site used to prove semantic extraction and action reliability.
- `12_ARCHITECTURE_DECISIONS_AND_OPEN_QUESTIONS.md` - frozen decisions, future scope, intentionally unresolved choices, change-control process.

## MVP statement

The MVP is text-first and current-tab-first. It does NOT include voice, screenshots, visual computer use, ASCII layout rendering, arbitrary JavaScript execution, multi-tab automation, persistent autonomous background work, password handling, payment-card entry, or a dependency on WebMCP.

The MVP proves one thing well:

> Given a user goal and the current webpage, the system can build a compact semantic page model, let an LLM choose one allowed browser action, execute it safely, observe the new state, and reliably complete supported test tasks.

## Source-of-truth policy

The repository implementation is subordinate to these specifications until a decision record explicitly changes the specification. A code change that conflicts with these documents is a bug unless the relevant decision was intentionally revised.
