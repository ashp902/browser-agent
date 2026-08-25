// Browser Agent side panel (docs/01 §2.1).
//
// M3 adds the temporary developer action console (docs/09 Milestone 3): a
// manual tool/element-id entry point so actions can be exercised end-to-end
// without an LLM. Page-derived strings are rendered as escaped React text only
// (docs/01 §14); never as HTML.

import { useCallback, useEffect, useState } from 'react';
import {
  buildBoundAction,
  executeActivePageAction,
  getActiveContext,
  observeActivePage,
  type LocalCallResult,
} from './extension-client';
import { useTaskRunner } from './task-runner';
import type { ActiveContextData } from '../shared/messages';
import type { ObservationData } from '../shared/semantic-contracts';
import type { ActionResult, BrowserToolName } from '../shared/action-protocol';
import { BROWSER_TOOLS } from '../shared/action-protocol';
import type { LocalError } from '../shared/errors';
import type { PanelState } from './state/machine';

type ContextLoad =
  | { status: 'loading' }
  | { status: 'loaded'; result: LocalCallResult<ActiveContextData> };

type InspectLoad = LocalCallResult<ObservationData> | null;

export function App() {
  const runner = useTaskRunner();
  const [context, setContext] = useState<ContextLoad>({ status: 'loading' });
  const [inspection, setInspection] = useState<InspectLoad>(null);

  const load = useCallback(
    () => getActiveContext().then((result) => setContext({ status: 'loaded', result })),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    setContext({ status: 'loading' });
    void load();
  }, [load]);

  const inspect = useCallback(() => {
    void observeActivePage().then((result) => {
      setInspection(result);
    });
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '0.75rem' }}>
      <h1>Browser Agent</h1>
      <TaskSection runner={runner} />
      <section aria-label="Active tab context">
        <h2>Active tab</h2>
        {context.status === 'loading' ? <p>Resolving active tab…</p> : <ActiveContextView result={context.result} />}
        <button type="button" onClick={refresh}>
          Refresh context
        </button>
      </section>
      <section aria-label="Inspect page (development)">
        <h2>Inspect page</h2>
        <button type="button" onClick={inspect}>
          Inspect semantic snapshot
        </button>
        {inspection === null ? null : <InspectionView result={inspection} />}
      </section>
      <ActionConsole observation={successfulInspection(inspection)} />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Task section (docs/01 §2.1): goal input, cancel control, transcript
// ---------------------------------------------------------------------------

const ACTIVE_TASK_STATES: ReadonlySet<PanelState> = new Set([
  'STARTING',
  'OBSERVING',
  'THINKING',
  'ACTING',
  'WAITING_CONFIRMATION',
  'WAITING_MANUAL_ACTION',
]);

function TaskSection({ runner }: { runner: ReturnType<typeof useTaskRunner> }) {
  const [goal, setGoal] = useState('');
  const isActive = ACTIVE_TASK_STATES.has(runner.state);

  const startDisabled = isActive || goal.trim().length === 0;
  return (
    <section aria-label="Task">
      <h2>Task</h2>
      <p>
        State: <strong>{runner.state}</strong>
      </p>
      <label style={{ display: 'block' }}>
        Goal{' '}
        <input
          type="text"
          value={goal}
          disabled={isActive}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="What should the agent do?"
        />
      </label>{' '}
      {!isActive ? (
        <button type="button" disabled={startDisabled} onClick={() => void runner.start(goal.trim())}>
          Start task
        </button>
      ) : (
        // The user must always have a visible Stop/Cancel control (docs/01 §11).
        <button type="button" onClick={runner.stop}>
          Stop
        </button>
      )}
      <GatePrompt runner={runner} />
      {runner.transcript.length > 0 && (
        <ol aria-label="Task transcript" style={{ fontSize: '0.8rem', paddingLeft: '1rem' }}>
          {runner.transcript.map((line, index) => (
            <li key={`${index}-${line.slice(0, 12)}`}>{line}</li>
          ))}
        </ol>
      )}
    </section>
  );
}

function GatePrompt({ runner }: { runner: ReturnType<typeof useTaskRunner> }) {
  const prompt = runner.prompt;
  if (prompt === null) return null;

  if (prompt.kind === 'confirmation') {
    return (
      <div role="alertdialog" aria-label="Confirm consequential action" style={{ background: '#fff7e6', padding: '0.5rem', borderRadius: '4px' }}>
        <p>
          <strong>Confirm:</strong> {prompt.summary}
        </p>
        <button type="button" onClick={() => runner.respondConfirmation(prompt.confirmationId, true)}>
          Approve
        </button>{' '}
        <button type="button" onClick={() => runner.respondConfirmation(prompt.confirmationId, false)}>
          Deny
        </button>
      </div>
    );
  }

  return (
    <div role="alertdialog" aria-label="Manual action required" style={{ background: '#eef5ff', padding: '0.5rem', borderRadius: '4px' }}>
      <p>
        <strong>{prompt.reason}</strong>
      </p>
      <p>{prompt.instruction}</p>
      <button type="button" onClick={runner.resumeManual}>
        Resume
      </button>
    </div>
  );
}

/** Only successful observations provide a binding for actions. */
function successfulInspection(load: InspectLoad): ObservationData | null {
  return load !== null && load.ok ? load.data : null;
}

function ActiveContextView({ result }: { result: LocalCallResult<ActiveContextData> }) {
  if (!result.ok) {
    return <LocalErrorView error={result.error} />;
  }
  const { tab, content_runtime } = result.data;
  return (
    <dl>
      <dt>Tab ID</dt>
      <dd>{tab.tab_id}</dd>
      <dt>Title</dt>
      <dd>{tab.title || '(untitled)'}</dd>
      <dt>URL</dt>
      <dd style={{ overflowWrap: 'anywhere' }}>{tab.url}</dd>
      <dt>Content runtime</dt>
      <dd>{content_runtime.status}</dd>
      <dt>Document ID</dt>
      <dd>{content_runtime.document_id}</dd>
    </dl>
  );
}

function InspectionView({ result }: { result: LocalCallResult<ObservationData> }) {
  if (!result.ok) {
    return <LocalErrorView error={result.error} />;
  }
  const observation = result.data;
  return (
    <>
      <p>
        Snapshot <strong>{observation.snapshot_id}</strong>, epoch {observation.mutation_epoch},{' '}
        {observation.stats.node_count} nodes ({observation.stats.actionable_count} actionable),{' '}
        {observation.stats.serialized_chars} chars.
      </p>
      <pre
        aria-label="Semantic page text"
        style={{
          fontSize: '0.75rem',
          whiteSpace: 'pre-wrap',
          background: '#f5f5f5',
          padding: '0.5rem',
          borderRadius: '4px',
        }}
      >
        {observation.semantic_text}
      </pre>
    </>
  );
}

function LocalErrorView({ error }: { error: LocalError }) {
  return (
    <div role="alert">
      <p>
        <strong>{error.code}</strong>
      </p>
      <p>{error.message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Developer action console (temporary; docs/09 Milestone 3)
// ---------------------------------------------------------------------------

function ActionConsole({ observation }: { observation: ObservationData | null }) {
  const [tool, setTool] = useState<BrowserToolName>('click_element');
  const [argsText, setArgsText] = useState('{"element_id": 1}');
  const [outcome, setOutcome] = useState<LocalCallResult<ActionResult> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(() => {
    setError(null);
    if (observation === null) {
      setError('Inspect the page first: actions bind to the latest observation.');
      return;
    }
    let args: unknown;
    try {
      args = JSON.parse(argsText);
    } catch {
      setError('Args must be valid JSON.');
      return;
    }
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      setError('Args must be a JSON object.');
      return;
    }
    // Bound request: carries this observation's document identity, epoch, and
    // fingerprint so the executor revalidates exactly what was observed.
    const action = buildBoundAction(observation, tool, args as Record<string, unknown>);
    void executeActivePageAction(action).then(setOutcome);
  }, [argsText, tool, observation]);

  return (
    <section aria-label="Developer action console">
      <h2>Action console (dev)</h2>
      <label>
        Tool{' '}
        <select value={tool} onChange={(event) => setTool(event.target.value as BrowserToolName)}>
          {BROWSER_TOOLS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>{' '}
      <label>
        Args JSON <input type="text" value={argsText} onChange={(event) => setArgsText(event.target.value)} />
      </label>{' '}
      <button type="button" onClick={run} disabled={observation === null}>
        Run action
      </button>
      {error !== null && <p role="alert">{error}</p>}
      {observation === null && (
        <p>Run "Inspect semantic snapshot" first - actions bind to the latest observation.</p>
      )}
      {outcome === null ? null : <ActionResultView result={outcome} />}
    </section>
  );
}

function ActionResultView({ result }: { result: LocalCallResult<ActionResult> }) {
  if (!result.ok) {
    return <LocalErrorView error={result.error} />;
  }
  const action = result.data;
  return action.ok ? (
    <p>
      OK — {action.summary}
      {action.changed === undefined ? '' : ` (changed=${String(action.changed)})`}
    </p>
  ) : (
    <div role="alert">
      <p>
        <strong>{action.error?.code ?? 'ACTION_FAILED'}</strong> — {action.summary}
      </p>
    </div>
  );
}
