# Manual verification log

Automated tests cover the deterministic core. The checks below require a real
Chrome session and must be run per milestone before that milestone is called
complete (docs/09 acceptance lists, docs/01 §17).

## Milestone 1 - Extension nervous system

Prerequisites: `cd extension && npm run build`; `cd test-site && npm run dev`
(serves http://localhost:5173).

1. **Install.** Open `chrome://extensions`, enable Developer mode, "Load
   unpacked" -> `extension/dist`. No permission warnings beyond `activeTab` and
   the localhost backend host permission should appear.
2. **Side panel opens from action icon.** On any ordinary page, click the
   Browser Agent toolbar action. The side panel opens showing the active tab's
   ID, title, URL, content-runtime status `ready`, and a document ID.
3. **Content runtime responds.** The "Active tab" section shows `ready` with a
   document ID on http://localhost:5173 without manual page reload.
4. **Reload creates a new document ID.** Reload the page, press "Refresh
   context" in the panel. The document ID differs from step 3.
5. **Unsupported page returns typed error.** Navigate the tab to
   `chrome://extensions`, then refresh the panel context. It shows
   `UNSUPPORTED_URL` with a safe message.
6. **Permission loss is surfaced, not silent.** With the panel open on the test
   site, open a cross-origin link (or navigate to a site never invoked with the
   action) and refresh context without clicking the toolbar action again: the
   panel shows `PERMISSION_REQUIRED`. Click the toolbar action on that tab and
   refresh: context loads.
7. **Service-worker restart does not break the panel.** In
   `chrome://extensions`, stop the service worker (Service worker link ->
   stop/terminate). The panel shell stays rendered and functional; pressing
   "Refresh context" wakes the worker and reloads context.
8. **No disallowed permissions.** `npm run test` (manifest guard) and
   `npm run build` (build-time manifest validation) both pass.

## Milestone 2 - Semantic perception

Prerequisites: `cd extension && npm run build`; a page with meaningful content
open (the reference site or any ordinary web page).

1. **Inspect Page dev view.** Open the side panel on an ordinary page, press
   "Inspect semantic snapshot". The panel shows snapshot id, mutation epoch,
   node/actionable counts, serialized character count, and the compact
   semantic text (roles, `@id`s, names, values, states, hierarchy).
2. **Hierarchy association.** On a page with repeated cards/rows containing
   identically-labeled buttons, confirm each button appears inside its own
   GROUP/ROW/LISTITEM block rather than as a flat list.
3. **Hidden content excluded.** On a page with hidden/aria-hidden/display:none
   content, confirm only visible semantics appear.
4. **Secrets omitted.** Type a value into a password field, inspect: the field
   appears by name but carries no `value=`; ordinary text fields do show their
   values.
5. **Mutation epoch advances.** Inspect, then trigger a DOM change on the page
   (e.g., open a details element), inspect again: the epoch increments.
6. **Unsupported pages refuse observation.** Navigate to `chrome://extensions`
   and press Inspect: the panel shows `UNSUPPORTED_URL`.
7. **Golden stability.** `npm run test` includes the 14 required fixture
   goldens (docs/02 §22); any representation change requires intentional
   regeneration via `npm run goldens:update` plus diff review (docs/08 §5).

## Milestone 3 - Deterministic action executor

Prerequisites: `cd extension && npm run build`; reference test site running
(`cd test-site && npm run dev`, http://localhost:5173/products once fixture
routes land); extension rebuilt.

1. **Manual action without an LLM.** Open the side panel on the products page,
   press "Inspect semantic snapshot", note a `Buy` button's `@id` from the
   semantic text, then in "Action console (dev)" run
   `click_element` with `{"element_id": <id>}`. The panel reports
   `OK — Clicked button "Buy".` and the page reacts.
2. **Repeated-button disambiguation.** Repeat against two different product
   cards' `Buy` buttons by their distinct IDs; each click affects only the
   chosen card.
3. **Stale targets are safe.** Inspect, trigger a DOM rerender (or navigate and
   come back so IDs reset), re-run the old element ID: the panel shows
   `TARGET_NOT_FOUND`/`STALE_TARGET` with a retryable message - never a wrong
   click.
4. **Form events work in React controls.** Run `set_text` on the search box and
   `select_option` (`option_label`) on filter selects; the site's React state
   updates (results change), proving prototype-setter + input/change dispatch.
5. **Sensitive refusal.** On the login page run `set_text` targeting the
   password field ID: result is `UNSUPPORTED_TARGET` ("filled in manually");
   the password value never appears anywhere in the panel or logs.
6. **Navigation schemes.** Run `navigate_current_tab` with
   `{"url":"javascript:alert(1)"}` -> `NAVIGATION_BLOCKED`; with a relative
   https URL -> navigation proceeds and a fresh observation shows the new
   document_id.
7. **Duplicate suppression.** Re-sending the exact same action (same action_id)
   cannot be produced from the console (fresh UUIDs per run) - covered by unit
   tests; verify via network-retry simulation if desired.
8. **Checkbox/radio logic.** `set_checked` true/false toggles checkboxes;
   radio `false` returns `UNSUPPORTED_TARGET`.

## Milestone 4 - Backend protocol and mock agent

Prerequisites: backend running (`cd backend && source .venv/bin/activate &&
uvicorn app.main:app --port 8000`); extension rebuilt and loaded.

1. **End-to-end task without an LLM.** Open an ordinary page with a button,
   open the side panel, enter a goal ("demo"), press Start task. The panel
   walks OBSERVING -> THINKING -> ACTING -> ... and completes with the mock
   summary; the transcript shows `Clicked button "Buy".` style narration from
   real page actions routed backend -> extension -> page -> backend.
2. **Cancellation.** Press Stop while the task runs. The panel shows CANCELED,
   sends cancel_task, and no further actions execute after the local cancel.
3. **Disconnect safety.** Stop the backend (Ctrl-C) mid-task. The panel marks
   the task FAILED locally and stops issuing actions; restarting the backend
   and starting a new task works (in-memory tasks are intentionally lost -
   TASK_NOT_FOUND path is covered by automated tests).
4. **Trace generation.** Completed/failed tasks carry a structured trace
   (steps, action summaries, policy, error codes, terminal reason) - asserted
   by `tests/test_ws_endpoint.py::test_full_task_traversal_over_websocket`.
5. **Protocol guards.** Wrong protocol version / unknown event types are
   rejected explicitly then disconnected; malformed known-type payloads get an
   INVALID_EVENT response while the connection stays usable (automated).
6. **Secrets hygiene.** Backend logs contain no API keys or page text by
   default (`tests/test_health.py`, redaction filter in telemetry).

## Milestone 5 - LLM agent loop

Implemented: provider boundary + Anthropic adapter (`providers/selected_provider.py`,
httpx-only), system prompt with untrusted-observation framing, JSON tool
schemas from the catalog, loop detection (3 identical failing signatures or a
3-cycle A/B alternation -> `AGENT_LOOP_DETECTED`), semantic hashing, history
compaction (last 8 steps verbatim). Reference test site implements docs/11:
12 products with repeated `Buy` cards, filters/sort/search, cart, checkout
with fake payment fields, orders table, return dialog, account form, login
with password field, prompt-injection fixture text, inventory-refresh harness.

Automated: `backend/tests/test_provider_anthropic.py` (adapter over mocked
HTTP - no live calls), `test_loop_detection.py`, `test_mock_provider.py`,
prompt-framing assertions; `backend/evals/tasks.yaml` pins the first 10
read/navigation eval tasks with deterministic success assertions.

Remaining for full Milestone 5 acceptance is now executable via the E2E
harness (`e2e/`, docs/08 §7):

1. Set provider credentials in the environment - either
   `LLM_PROVIDER=anthropic` or `LLM_PROVIDER=openrouter` (OpenAI-compatible
   endpoint; any tool-calling model id such as `anthropic/claude-sonnet-4.5`)
   - plus `LLM_API_KEY` and `LLM_MODEL`. The harness starts the backend,
   reference site, and browser.
2. Run `cd e2e && npm install && npx playwright install chromium`.
3. `npm run smoke` — deterministic full-chain proof (mock agent; no key needed).
4. `EVAL_RUNS=20 EVAL_ENFORCE=1 npm run evals` — executes the 10 pinned tasks
   from `backend/evals/tasks.yaml`, writes `results/eval-summary.json`, and
   enforces the >=90% gate (raise to >=95% for Milestone 7 with the expanded
   task set). Safety-invariant tasks must pass on every run.

## Milestone 6 - Safety gates

Implemented: versioned consequence rules (`app/policy/rules.py` v1) +
deterministic engine (`ALLOW / REQUIRE_CONFIRMATION / REQUIRE_MANUAL_USER_ACTION /
DENY`), bound confirmation tokens (action/document/fingerprint/expiry) verified
at the service-worker gate AND inside the executor, panel Approve/Deny UI,
manual password/secret flow with Resume, `POLICY_DENIED`,
`CONFIRMATION_EXPIRED`, `USER_DENIED_ACTION`, `MANUAL_ACTION_REQUIRED`
(PASSWORD_REQUIRED / SENSITIVE_FIELD).

Automated coverage (docs/06 §16 mapping):
- checkout submit always requires confirmation -> `test_policy_engine.py`
  keyword families + `test_safety_gates.py::test_consequential_action_...`
- user denial prevents action -> `test_user_denial_prevents_action_...`
- changed target invalidates approval ->
  `test_changed_target_fingerprint_rejected` (backend) and the matching
  extension token test
- password value never reaches backend spy -> 
  `test_password_field_goes_manual_and_secret_never_dispatched` (no
  action_request ever emitted; snapshot omits secret values per docs/02 §9)
- forbidden schemes denied -> policy DENY + executor NAVIGATION_BLOCKED tests
- duplicate/idempotency + cancellation guards -> Milestones 3-4 suites
- injected hostile page text cannot create capability -> capability restriction
  is structural (fixed tool catalog + policy gates); reference site carries the
  docs/11 §14 injection string; live-model behavioral check runs as eval task
  `ignore_injected_instruction`.

Manual verification:
1. On the reference checkout page, task "Place the order": panel shows a
   Confirm prompt with a summary; Deny stops the order from being placed.
2. Approve executes exactly that frozen action; a page change between approval
   and execution causes STALE_TARGET refusal (token binding).
3. Task "Log in with password hunter2": agent fills nothing, panel shows
   PASSWORD_REQUIRED instruction; type it manually on the page, press Resume;
   observation resumes and the value never appears in the transcript or logs.
4. Let a confirmation sit >120 s: task fails CONFIRMATION_EXPIRED.
5. Production-mode check: run uvicorn with default LOG_LEVEL and confirm logs
   contain no semantic page text or secrets.
