# 08 - Testing, Evals, and Observability

Status: AUTHORITATIVE FOR MVP

## 1. Objective

Browser agents fail in probabilistic and deterministic ways. This project is not complete when a demo works once. We need repeatable fixtures, golden semantic snapshots, end-to-end task evals, and traces that identify whether a failure came from perception, model choice, execution, policy, or navigation.

## 2. Test pyramid

```text
                    task evals
                 extension E2E
              component integration
             deterministic unit tests
```

The lower layers should contain most tests.

## 3. TypeScript unit tests

Use Vitest.

Required suites:

### Semantic extractor

- role mapping;
- accessible-name precedence;
- hidden filter;
- state extraction;
- wrapper collapsing;
- repeated-group inference;
- table/list/form hierarchy;
- text truncation;
- password omission;
- stable serialization.

### Registry

- stable ID for same Element;
- monotonic IDs;
- no reuse;
- new document reset;
- stale/disconnected target.

### Executor

- click;
- input text;
- native select;
- checkbox/radio;
- disabled/read-only refusal;
- sensitive field refusal;
- navigation scheme validation;
- action idempotency.

### Messaging

- schema validation;
- unknown message rejection;
- sender/target checks;
- safe error normalization.

## 4. Python unit tests

Use pytest.

Required:

- wire event schema;
- session state machine;
- tool schema validation;
- model adapter normalization;
- policy classification;
- confirmation binding/expiry;
- max steps;
- loop detection;
- cancellation;
- telemetry redaction.

## 5. Golden semantic fixtures

Create HTML fixtures and expected `.semantic.txt` outputs.

Golden test structure:

```text
extension/tests/fixtures/
  product-cards/
    page.html
    expected.semantic.txt
  repeated-table-actions/
    page.html
    expected.semantic.txt
  form-labels/
    ...
```

A semantic serializer change that alters goldens requires intentional review. The coding agent must not bulk-update goldens merely to make tests pass without explaining why representation changed.

## 6. Reference test site

Use document 11. The site is deterministic and purpose-built to exercise:

- search;
- filters;
- repeated product cards;
- cart;
- checkout confirmation;
- orders table;
- return action;
- account form;
- modal/dialog;
- dynamic DOM mutations.

No real payment/login needed.

## 7. Extension E2E

Use Playwright with Chromium and a persistent browser context capable of loading the unpacked extension.

E2E tests must run against local reference site and backend test instance.

At minimum:

1. Load extension.
2. Open reference site.
3. Invoke extension and side panel.
4. Observe page.
5. Execute action through actual messaging path.
6. Verify DOM changed.

Tests should not bypass content script/action executor by directly manipulating page when testing agent flow.

## 8. Task eval dataset

Maintain versioned tasks:

```yaml
- id: search_black_shoes_under_100
  start_url: /products
  goal: Find black running shoes under $100.
  success_assertion: ...
  max_steps: 12

- id: add_size_10_second_result
  ...
```

Each task defines a deterministic success assertion implemented against reference-site state, not natural-language self-evaluation by the model.

## 9. Initial task set

At least 20 tasks before MVP is considered reliable. Include:

- search by text;
- select one filter;
- combine two filters;
- sort;
- choose repeated card action correctly;
- select size and add to cart;
- remove cart item;
- change quantity;
- navigate to orders;
- identify latest order;
- start return;
- edit account field;
- refuse password field automation;
- handle modal;
- handle disabled action;
- require checkout confirmation;
- user denies confirmation;
- stale target after dynamic rerender;
- same-origin navigation;
- cross-origin permission blocker.

## 10. Metrics

Record per run:

### Reliability

- task success rate;
- first-attempt task success;
- average actions per successful task;
- invalid model action rate;
- stale-target rate;
- executor failure rate;
- policy block/confirmation rate;
- loop rate.

### Efficiency

- end-to-end latency;
- model latency;
- local observation latency;
- action latency;
- semantic serialized characters/tokens estimate;
- model input/output token usage where provider exposes it.

### Safety

- consequential actions attempted without confirmation: target 0;
- secret-field values sent to backend: target 0;
- duplicate action execution: target 0;
- forbidden URL action execution: target 0.

## 11. MVP acceptance targets

On deterministic reference site with selected production candidate model:

```text
Supported task success: >= 95% over 20 runs per task
Unsafe consequential execution: 0
Password/secret leakage tests: 0 failures
Duplicate execution: 0
Semantic golden tests: 100% pass
Unit/integration tests: 100% pass
```

Do not claim "works on the web" from reference-site results. External-site testing is a later benchmark.

## 12. External-site smoke suite

After reference-site acceptance, maintain a non-destructive manual smoke list of public websites for read/search/filter tasks. Never automate purchases or account changes during smoke testing.

Because public sites change, these are observational health checks, not hard CI gates.

## 13. Trace model

Every agent task gets a structured trace:

```text
Task
  Step 1
    observation metadata
    semantic hash
    model decision
    policy decision
    action request
    action result
    timings
  Step 2
    ...
```

Trace MUST distinguish:

- perception failure;
- reasoning/tool-selection failure;
- target-stale failure;
- executor failure;
- policy block;
- permission/navigation block;
- user denial/manual action.

## 14. Semantic hashing

Create a normalized hash of model-facing semantic text after removing volatile fields such as snapshot UUID/timestamp. Use this for:

- loop detection;
- regression comparison;
- progress analysis.

Do not treat hash as security integrity mechanism.

## 15. Debug capture

Development mode MAY store full semantic snapshots and model request/response for a local test task.

Production default MUST NOT.

Tests must verify debug capture is disabled in production config.

## 16. CI gates

CI should fail on:

- TypeScript type errors;
- Python type/schema errors where enforced;
- unit test failure;
- semantic golden diff;
- lint failure;
- remote executable code detection in extension bundle;
- forbidden manifest permission appearing;
- secret scanner finding committed credential pattern;
- reference-site E2E critical-path failure.

## 17. Failure triage procedure

For a failed task, classify in this order:

1. Did semantic snapshot contain the needed element/content?
2. Was relationship/grouping correct?
3. Did model choose a valid ID/tool?
4. Did policy alter/block it correctly?
5. Did executor target remain valid?
6. Did action cause expected page behavior?
7. Did next observation capture result?
8. Did finish verification correctly determine outcome?

Do not change prompt first for every failure. Fix the layer that failed.
