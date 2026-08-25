// Eval suite (docs/08 §8-§11): executes backend/evals/tasks.yaml against the
// reference site through the real extension UI and computes pass rates.
//
// Provider selection:
//   - default: mock provider on :8001 -> mechanical dry-run of the harness
//   - LLM_PROVIDER=anthropic + LLM_API_KEY + LLM_MODEL in env: live model on
//     :8000
//
// Gates: EVAL_RUNS=N repeats each task; EVAL_ENFORCE=1 turns the documented
// acceptance thresholds into hard assertions.

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const specDir = path.dirname(fileURLToPath(import.meta.url));

import {
  harnessSnapshot,
  launchSession,
  startTask,
  transcriptLines,
  waitForTerminal,
  type Session,
  type TerminalState,
} from '../helpers/extension';
import { evaluateAssertion, type EvalTask } from '../helpers/assertions';

const TASKS_FILE = path.resolve(specDir, '../../backend/evals/tasks.yaml');
const RUNS = Number(process.env.EVAL_RUNS ?? '1');
const ENFORCE = process.env.EVAL_ENFORCE === '1';
// Provider configuration comes from process.env or backend/.env (which the
// backend itself loads). A configured live provider routes to :8000; otherwise
// evals dry-run against the mock backend on :8001.
function loadBackendEnv(): Record<string, string> {
  const envFile = path.resolve(specDir, '../../backend/.env');
  if (!fs.existsSync(envFile)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const backendEnvFile = loadBackendEnv();
const PROVIDER = process.env.LLM_PROVIDER ?? backendEnvFile.LLM_PROVIDER ?? '';
const MODEL = process.env.LLM_MODEL ?? backendEnvFile.LLM_MODEL ?? '';
const LIVE_PROVIDER = /^(anthropic|openrouter|openai)$/.test(PROVIDER);
const BACKEND_WS =
  process.env.EVAL_BACKEND_WS ??
  (LIVE_PROVIDER ? 'ws://localhost:8000/v1/agent/ws' : 'ws://localhost:8001/v1/agent/ws');
const PASS_THRESHOLD = Number(process.env.EVAL_PASS_RATE ?? '0.9');

const dataset = YAML.parse(fs.readFileSync(TASKS_FILE, 'utf8')) as {
  defaults?: { max_steps?: number; start_url?: string };
  tasks: EvalTask[];
};

interface RunRecord {
  task: string;
  run: number;
  state: TerminalState | 'CANCELED-BY-TIMEOUT';
  pass: boolean;
  reasons: string[];
}

const results: RunRecord[] = [];

test.describe('reference-site evals', () => {
  test.skip(process.env.SKIP_EVALS === '1', 'EVALS skipped via SKIP_EVALS=1');

  for (const task of dataset.tasks) {
    for (let run = 1; run <= RUNS; run += 1) {
      test(`${task.id} run ${run}/${RUNS}`, async () => {
        const session: Session = await launchSession(BACKEND_WS);
        try {
          // Persist raw frames for post-run diagnosis (docs/08 §17 triage).
          fs.mkdirSync(path.resolve(specDir, '../results'), { recursive: true });
          const frameLog = path.resolve(
            specDir,
            `../results/frames-${task.id}-${run}.log`,
          );
          session.panel.on('websocket', (ws) => {
            ws.on('framesent', (f) => fs.appendFileSync(frameLog, String(f.payload) + '\n'));
            ws.on('framereceived', (f) => fs.appendFileSync(frameLog, String(f.payload) + '\n'));
          });
          await session.site.goto(`http://localhost:5173${task.start_url ?? '/products'}`);
          await session.site.evaluate(() => window.__SHOP_HARNESS__.reset());
          // Reload so page-local filter/search/sort React state is fresh too.
          await session.site.reload();
          await session.site.bringToFront();

          await startTask(session.panel, task.goal);
          const finalState = await waitForTerminal(session.panel, Number(process.env.EVAL_TASK_TIMEOUT_MS ?? 420_000));

          const lines = await transcriptLines(session.panel);
          let setTextDispatched = 0;
          try {
            for (const line of fs.readFileSync(frameLog, 'utf8').split('\n')) {
              if (!line.trim()) continue;
              const frame = JSON.parse(line);
              if (
                frame.type === 'action_result' &&
                frame.payload?.result?.ok === true &&
                frame.payload?.result?.data?.value_length !== undefined
              ) {
                setTextDispatched += 1;
              }
            }
          } catch {
            // Missing frame log just means fewer diagnostics.
          }
          const outcome = {
            finalState,
            summaryText: lines.join('\n'),
            siteUrl: session.site.url(),
            harness: await harnessSnapshot(session.site),
            setTextDispatched,
          };
          const assertion = evaluateAssertion(task, outcome);
          results.push({
            task: task.id,
            run,
            state: finalState,
            pass: assertion.pass,
            reasons: assertion.reasons,
          });

          if (!assertion.pass) {
            console.warn(`[eval] ${task.id} #${run} FAIL:`, assertion.reasons, lines);
          }
        } finally {
          await session.context.close();
        }
      });
    }
  }

  test.afterAll(async () => {
    if (results.length === 0) return;
    const passed = results.filter((r) => r.pass).length;
    const rate = passed / results.length;
    console.log('\n===== EVAL SUMMARY =====');
    for (const record of results) {
      console.log(
        `${record.pass ? 'PASS' : 'FAIL'}  ${record.task} #${record.run} (${record.state})` +
          (record.reasons.length ? ` :: ${record.reasons.join('; ')}` : ''),
      );
    }
    console.log(`Pass rate: ${(rate * 100).toFixed(1)}% (${passed}/${results.length})`);
    fs.mkdirSync(path.resolve(specDir, '../results'), { recursive: true });
    fs.writeFileSync(
      path.resolve(specDir, '../results/eval-summary.json'),
      JSON.stringify({ rate, passed, total: results.length, results }, null, 2),
    );
    if (ENFORCE && LIVE_PROVIDER) {
      console.log(`Gate: provider=${PROVIDER} model=${MODEL} threshold=${PASS_THRESHOLD}`);
      expect(rate).toBeGreaterThanOrEqual(PASS_THRESHOLD);
      expect(results.filter((r) => r.task.includes('secret') && !r.pass).length).toBe(0);
    }
  });
});
