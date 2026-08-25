# 12 - Architecture Decisions and Open Questions

Status: AUTHORITATIVE DECISION REGISTER

## 1. Purpose

This file prevents silent architectural drift. Decisions marked FROZEN are required until explicitly changed. OPEN decisions are intentionally unresolved and must not be guessed by an implementation agent if they become blocking.

## 2. Frozen decisions

### ADR-001 - Chrome extension is Manifest V3

Status: FROZEN

Reason: current Chrome extension platform and Side Panel/service-worker model.

### ADR-002 - Side panel is primary UI

Status: FROZEN

The side panel owns the live task UI and backend connection.

### ADR-003 - MVP permissions are minimal

Status: FROZEN

Permissions:

```text
activeTab
scripting
sidePanel
storage
```

plus project-backend host permission.

No `<all_urls>` and no `debugger`.

### ADR-004 - Semantic DOM is sole MVP perception mode

Status: FROZEN

No screenshot, vision, or ASCII layout in MVP.

### ADR-005 - ASCII layout is future scope

Status: FROZEN AS DEFERRAL

The idea is retained as a possible secondary layout projection derived from the same page model. It does not replace semantic representation and is not implemented before semantic-MVP acceptance.

### ADR-006 - Page representation is hierarchical

Status: FROZEN

Repeated actions must stay associated with groups/rows/list items/forms. Flat element lists are prohibited.

### ADR-007 - Opaque element IDs, never model-generated selectors

Status: FROZEN

Model acts on IDs from latest observation.

### ADR-008 - One state-changing action per model step

Status: FROZEN

Always re-observe afterward.

### ADR-009 - Backend orchestration, extension actuation

Status: FROZEN

LLM/provider keys stay backend-side.

### ADR-010 - Backend uses FastAPI + WebSocket

Status: FROZEN FOR MVP

Python 3.12+, Pydantic v2.

### ADR-011 - Extension uses TypeScript + React + Vite

Status: FROZEN FOR MVP

### ADR-012 - No generic agent framework initially

Status: FROZEN

No LangChain/LangGraph/etc. unless explicit later decision shows clear benefit. Implement small orchestrator directly.

### ADR-013 - Secret input is manual

Status: FROZEN

No passwords, OTPs, card data automation in MVP.

### ADR-014 - Consequential final actions require user confirmation

Status: FROZEN

Confirmation bound to frozen action/target.

### ADR-015 - WebMCP is future adapter

Status: FROZEN AS DEFERRAL

MVP does not depend on it. Re-verify standard before implementing.

### ADR-016 - Reference site before broad web testing

Status: FROZEN

Reliability is established on deterministic fixture before external alpha.

### ADR-017 - `activeTab` limitation is accepted for MVP

Status: FROZEN

Cross-origin automation is not guaranteed. Do not silently request broad host permissions.

### ADR-018 - Do not invalidate every action on any mutation epoch change

Status: FROZEN

Revalidate target fingerprint; unrelated page mutations must not make all IDs unusable.

### ADR-019 - Development host permission for the local reference site

Status: FROZEN (dev-scope amendment to ADR-003)
Date: 2026-08-24
Supersedes: none (refines ADR-003 development-build allowance)
Decision: Development manifests include `http://localhost:5173/*` in
`host_permissions` alongside the existing backend permission, so the
deterministic reference fixture site is agent-accessible without repeated
toolbar re-invocation during automated E2E/eval runs.
Reason: `activeTab` grants access only after a user gesture; automated
Playwright runs cannot produce that gesture, and docs/08 §7 requires E2E
against the local reference site. Scope stays strictly local-dev.
Alternatives considered: `optional_host_permissions` runtime requests (needs
gesture too); `chrome.debugger` (explicitly forbidden).
Security/privacy impact: none in production builds; localhost-only surface.
Migration impact: release manifest continues to substitute the production API
host only.
Docs/tests updated: extension/manifest.json, README permissions section,
docs/MANUAL_VERIFICATION.md.

## 3. Explicit future scope

These are ideas, not current work:

- ASCII/layout projection;
- screenshot/vision fallback;
- exact browser accessibility-tree/CDP perception;
- WebMCP page-native tools;
- voice I/O;
- multi-tab tasks;
- optional persistent host permissions;
- cloud/background autonomous tasks;
- B2B agent-readiness/WebMCP SDK;
- cross-device identity/memory;
- scheduled tasks;
- richer secret delegation/credential handling after security design.

## 4. Open decisions

### OPEN-001 - Production user authentication

Question: How does side panel authenticate to backend in production?

Not blocking local MVP.

Do not choose Auth0, Clerk, Firebase, custom JWT, etc. yet.

### OPEN-002 - Production hosting platform

Question: Where is FastAPI hosted?

Not blocking local MVP. Keep 12-factor configuration.

### OPEN-003 - Production LLM provider/model

Question: Which provider/model is default at launch?

Architecture supports provider adapters. One provider may be chosen for development by explicit implementation task, but this does not remove adapter boundary.

### OPEN-004 - Durable task storage

Question: When do we need Postgres/Redis?

Not before restart/resume or multi-device requirements.

### OPEN-005 - Optional host-permission UX

Question: How do we evolve beyond `activeTab` for cross-origin/multi-page agent workflows while maintaining user trust?

Future product/security decision.

### OPEN-006 - Exact WebMCP consumption path from extension

Question: What stable browser/extension API should be used after standard matures?

Current CDP WebMCP exists, but `chrome.debugger` implications make this intentionally unresolved.

### OPEN-007 - Contenteditable/rich-editor actuation

Question: What deterministic tool contract supports rich text editors?

Not required by reference MVP.

### OPEN-008 - Shadow DOM traversal depth/policy

Question: Should open shadow roots be traversed by default and how are IDs/relationships serialized?

If encountered before MVP reference site requires it, add a targeted decision rather than improvising.

### OPEN-009 - Production page-data retention

Question: What data, if any, is retained for product analytics/evals and for how long?

Must be answered before broad public beta.

## 5. Decision change template

When changing a frozen decision, append:

```text
ADR-XXX - Title
Status: FROZEN
Date:
Supersedes:
Decision:
Reason:
Alternatives considered:
Security/privacy impact:
Migration impact:
Docs/tests updated:
```

Do not delete old decisions; mark them superseded.

## 6. Unspecified behavior rule

If a coding task encounters behavior not covered here or another spec:

- if it is local implementation detail with no external/security/architecture impact, choose the simplest conventional implementation and document it in code;
- if it changes API, permission, data retention, model capability, user safety, repository boundary, tool set, or technology platform, it is an architectural decision and must be recorded before implementation.
