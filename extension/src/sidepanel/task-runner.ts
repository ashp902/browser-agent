// Task runner: drives the side-panel state machine across the full
// observe/decide/gate/act loop (docs/01 §10, docs/04 §2, docs/05 §8).
//
// The panel is a relay, not an orchestrator: decisions and gates come from the
// backend; page access flows through the service worker and content runtime.
// Only one action may be in flight per task; late action requests are ignored.

import { useCallback, useRef, useState } from 'react';
import { transition, type PanelEvent, type PanelState } from './state/machine';
import {
  BackendClient,
  DEFAULT_BACKEND_WS_URL,
} from './backend-client';
import { executeActivePageAction, observeActivePage } from './extension-client';

export interface ConfirmationPrompt {
  kind: 'confirmation';
  confirmationId: string;
  summary: string;
}

export interface ManualPrompt {
  kind: 'manual';
  reason: string;
  instruction: string;
}

export type ActivePrompt = ConfirmationPrompt | ManualPrompt | null;

export interface TaskRunner {
  state: PanelState;
  transcript: string[];
  prompt: ActivePrompt;
  start: (goal: string) => Promise<void>;
  stop: () => void;
  respondConfirmation: (confirmationId: string, approve: boolean) => void;
  resumeManual: () => void;
}

export function useTaskRunner(): TaskRunner {
  const [state, setState] = useState<PanelState>('IDLE');
  const [transcript, setTranscript] = useState<string[]>([]);
  const [prompt, setPrompt] = useState<ActivePrompt>(null);
  const clientRef = useRef<BackendClient | null>(null);
  const stateRef = useRef<PanelState>('IDLE');
  const actionInFlightRef = useRef(false);
  const approvedConfirmationRef = useRef<string | null>(null);

  const applyTransition = useCallback((event: PanelEvent): boolean => {
    try {
      const next = transition(stateRef.current, event);
      stateRef.current = next;
      setState(next);
      return true;
    } catch (error) {
      // Development builds reject illegal transitions loudly (docs/01 §10);
      // production keeps the last valid state rather than stranding the user.
      console.error('Rejected side-panel transition', event, error);
      return false;
    }
  }, []);

  const narrate = useCallback((line: string) => {
    setTranscript((lines) => [...lines.slice(-49), line]);
  }, []);

  const reportAndFail = useCallback(
    (code: string, message: string) => {
      clientRef.current?.reportClientError(code, message);
      applyTransition('FAIL');
    },
    [applyTransition],
  );

  const handleServerEvent = useCallback(
    async (event: import('../shared/wire-protocol').ServerEvent) => {
      switch (event.type) {
        case 'task_created':
          narrate(`Task started (${event.payload.task_id}).`);
          return;

        case 'request_observation': {
          if (!applyTransition('OBSERVE_BEGIN')) return;
          const observation = await observeActivePage();
          if (!observation.ok) {
            narrate(`${observation.error.code}: ${observation.error.message}`);
            reportAndFail(observation.error.code, observation.error.message);
            return;
          }
          if (!applyTransition('OBSERVE_DONE')) return;
          try {
            clientRef.current?.sendObservation(observation.data);
          } catch {
            narrate('Lost connection to the backend.');
            applyTransition('FAIL');
          }
          return;
        }

        case 'confirmation_request': {
          // docs/04 §18: the frozen consequential action waits for the user.
          setPrompt({
            kind: 'confirmation',
            confirmationId: event.payload.confirmation_id,
            summary: event.payload.summary,
          });
          applyTransition('CONFIRM_REQUIRED');
          narrate(`Confirm: ${event.payload.summary}`);
          return;
        }

        case 'manual_action_request':
          setPrompt({ kind: 'manual', reason: event.payload.reason, instruction: event.payload.instruction });
          applyTransition('MANUAL_REQUIRED');
          narrate(event.payload.instruction);
          return;

        case 'action_request': {
          // docs/05 §8: only one action may be in flight per task.
          if (actionInFlightRef.current) {
            console.warn('Ignored action_request while another action was in flight.');
            return;
          }
          if (stateRef.current === 'CANCELED' || stateRef.current === 'COMPLETED') return;

          const { action, policy, confirmation_token: token } = event.payload;
          if (policy === 'REQUIRE_CONFIRMATION') {
            if (token === undefined || approvedConfirmationRef.current !== token) {
              // Never execute an approved-consequential request we did not
              // explicitly approve in this session.
              narrate('Blocked an unapproved consequential action.');
              clientRef.current?.reportClientError('PERMISSION_REQUIRED', 'unapproved consequential action');
              applyTransition('FAIL');
              return;
            }
            applyTransition('CONFIRM_APPROVED');
            approvedConfirmationRef.current = null;
          } else if (!applyTransition('ACTION_BEGIN')) {
            return;
          }
          setPrompt(null);
          actionInFlightRef.current = true;

          const result = await executeActivePageAction(action, policy, token);
          actionInFlightRef.current = false;
          if (!result.ok) {
            narrate(`Action could not run: ${result.error.code} — ${result.error.message}`);
            clientRef.current?.reportClientError(result.error.code, result.error.message);
            applyTransition('FAIL');
            return;
          }
          narrate(result.data.summary);
          try {
            clientRef.current?.sendActionResult(result.data);
          } catch {
            applyTransition('FAIL');
          }
          return;
        }

        case 'status':
          if (event.payload.detail) narrate(event.payload.detail);
          return;

        case 'task_completed':
          setPrompt(null);
          narrate(event.payload.summary);
          applyTransition('COMPLETE');
          clientRef.current?.disconnect();
          return;

        case 'task_failed':
          setPrompt(null);
          narrate(`Task stopped: ${event.payload.code} — ${event.payload.message}`);
          if (stateRef.current !== 'CANCELED') applyTransition('FAIL');
          clientRef.current?.disconnect();
          return;

        default:
          return;
      }
    },
    [applyTransition, narrate, reportAndFail],
  );

  const start = useCallback(
    async (goal: string) => {
      if (stateRef.current !== 'IDLE') {
        if (isTerminal(stateRef.current)) {
          applyTransition('RESET');
        } else {
          return;
        }
      }
      setTranscript([]);
      setPrompt(null);
      if (!applyTransition('START')) return;

      const client = new BackendClient();
      clientRef.current = client;
      client.onServerEvent((event) => void handleServerEvent(event));
      client.onClose(() => {
        if (!isTerminal(stateRef.current)) {
          narrate('Backend connection closed.');
          applyTransition('FAIL');
        }
      });

      // E2E/eval runs may pin the backend port via ?backend=ws://...
      const backendUrl =
        new URLSearchParams(window.location.search).get('backend') ?? DEFAULT_BACKEND_WS_URL;
      try {
        await client.connect(backendUrl);
      } catch (error) {
        narrate(error instanceof Error ? error.message : 'Backend unreachable.');
        applyTransition('FAIL');
        return;
      }
      client.startTask(goal, chrome.runtime.getManifest().version);
    },
    [applyTransition, handleServerEvent, narrate],
  );

  const stop = useCallback(() => {
    applyTransition('CANCEL');
    setPrompt(null);
    clientRef.current?.cancelTask();
    window.setTimeout(() => clientRef.current?.disconnect(), 1500);
  }, [applyTransition]);

  const respondConfirmation = useCallback(
    (confirmationId: string, approve: boolean) => {
      const client = clientRef.current;
      if (client === null) return;
      if (approve) {
        // The follow-up action_request carries this token; CONFIRM_APPROVED
        // then moves us to ACTING (docs/01 §10).
        approvedConfirmationRef.current = confirmationId;
        client.respondConfirmation(confirmationId, 'approve');
        return;
      }
      client.respondConfirmation(confirmationId, 'deny');
      setPrompt(null);
      // Backend re-enters its decide phase after a denial.
      applyTransition('OBSERVE_DONE');
    },
    [applyTransition],
  );

  const resumeManual = useCallback(() => {
    setPrompt(null);
    clientRef.current?.resumeManual();
    applyTransition('MANUAL_DONE');
  }, [applyTransition]);

  return { state, transcript, prompt, start, stop, respondConfirmation, resumeManual };
}

function isTerminal(state: PanelState): boolean {
  return state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELED';
}
