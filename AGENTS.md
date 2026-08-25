# AGENTS.md

This repository implements the Browser Agent strictly per the specification pack in
`docs/`. AI coding agents working here MUST:

1. Read `docs/README.md`, `docs/10_AI_CODING_AGENT_RULES.md`,
   `docs/12_ARCHITECTURE_DECISIONS_AND_OPEN_QUESTIONS.md`, then the component spec
   relevant to the task before changing code.
2. Follow `docs/09_MVP_ROADMAP_AND_ACCEPTANCE.md` sequentially; do not pull future
   milestone scope forward.
3. Never add Chrome permissions, model tools, wire-schema changes, or new
   technologies without a decision record in `docs/12_...` first.
4. Keep the model away from arbitrary execution: no eval, no model-generated
   selectors/JavaScript/CDP, no remote hosted code.

Verification commands per component are in the root `README.md`.
