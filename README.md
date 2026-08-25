# Browser Agent

Chrome extension + backend agent that accepts a natural-language task, observes the
current webpage through a compact semantic representation, chooses one constrained
browser action at a time, executes it through the extension, re-observes, and
continues until the task completes or the user must intervene.

This repository is implemented strictly against the engineering specification pack
in [`docs/`](docs/README.md). Those documents are the source of truth; code is
subordinate to them.

## Repository layout

```text
docs/          Authoritative engineering specification pack
extension/     Chrome Manifest V3 extension (TypeScript, React, Vite)
backend/       FastAPI agent backend (Python 3.12+, Pydantic v2)
test-site/     Deterministic local reference site for testing (React + Vite)
```

## Prerequisites

- Node.js 20+ and npm
- Python 3.12+ (a tool-managed interpreter via `uv` is fine: `uv venv --python 3.12`)
- Google Chrome (recent, with Side Panel API support)

## Local setup

### Extension

```bash
cd extension
npm install
npm run build        # produces extension/dist (loadable unpacked extension)
npm run typecheck    # TypeScript, no emit
npm run lint         # eslint
npm run test         # vitest
```

Load the extension: open `chrome://extensions`, enable Developer mode, choose
"Load unpacked", select `extension/dist`. Clicking the toolbar action opens the
side panel.

### Backend

```bash
cd backend
uv venv --python 3.12 .venv        # or: python3.12 -m venv .venv
source .venv/bin/activate
uv pip install -e ".[dev]"         # or: pip install -e ".[dev]"
uvicorn app.main:app --reload      # serves http://localhost:8000
pytest                             # tests
ruff check app tests               # lint
```

Health endpoints: `GET /healthz`, `GET /readyz`.

### Reference test site

```bash
cd test-site
npm install
npm run dev          # serves http://localhost:5173
npm run build
npm run typecheck
```

### End-to-end tests and evals

The `e2e/` package runs the unpacked extension in Chromium against the local
reference site and backend (docs/08 §7). It starts both servers itself.

```bash
cd e2e
npm install
npx playwright install chromium
npm run smoke        # deterministic full-chain test (mock agent, no API key)

# Evals against backend/evals/tasks.yaml:
EVAL_RUNS=1 npm run evals                       # harness dry-run (mock agent)
# With a live model via Anthropic directly:
LLM_PROVIDER=anthropic LLM_API_KEY=... LLM_MODEL=<model> \
EVAL_RUNS=20 EVAL_ENFORCE=1 npm run evals       # acceptance gate (>=90% / >=95%)

# Or via OpenRouter (any tool-calling model, e.g. anthropic/claude-sonnet-4.5):
LLM_PROVIDER=openrouter LLM_API_KEY=sk-or-... LLM_MODEL=<vendor/model> \
EVAL_RUNS=20 EVAL_ENFORCE=1 npm run evals
```

Eval results land in `e2e/results/eval-summary.json`. Safety-invariant tasks
(secret-entry refusal, injection containment) must never fail.

## Specification discipline

- `docs/10_AI_CODING_AGENT_RULES.md` is the highest-authority implementation document.
- `docs/12_ARCHITECTURE_DECISIONS_AND_OPEN_QUESTIONS.md` records frozen decisions
  (ADRs) and open questions (OPEN-xxx). Architectural changes require a decision
  record before code changes.
- `docs/09_MVP_ROADMAP_AND_ACCEPTANCE.md` defines the implementation order. Do not
  pull later milestone scope forward.

## Permissions

The extension requests exactly: `activeTab`, `scripting`, `sidePanel`, `storage`,
plus a host permission for the project backend (`http://localhost:8000/*` in
development). Any permission change is an architecture change.
