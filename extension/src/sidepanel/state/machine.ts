// Side-panel UI state machine (docs/01 §10).
//
// Pure and total: transition() either returns the next state or rejects. In
// development builds illegal transitions throw; in production builds they are
// ignored so a UI bug can never strand the user in a broken state.

export type PanelState =
  | 'IDLE'
  | 'STARTING'
  | 'OBSERVING'
  | 'THINKING'
  | 'ACTING'
  | 'WAITING_CONFIRMATION'
  | 'WAITING_MANUAL_ACTION'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED';

export type PanelEvent =
  | 'START'
  | 'OBSERVE_BEGIN'
  | 'OBSERVE_DONE'
  | 'ACTION_BEGIN'
  | 'CONFIRM_REQUIRED'
  | 'CONFIRM_APPROVED'
  | 'CONFIRM_DENIED'
  | 'MANUAL_REQUIRED'
  | 'MANUAL_DONE'
  | 'COMPLETE'
  | 'FAIL'
  | 'CANCEL'
  | 'RESET';

const TERMINAL_STATES: ReadonlySet<PanelState> = new Set(['COMPLETED', 'FAILED', 'CANCELED']);

const TRANSITIONS: Record<PanelState, Partial<Record<PanelEvent, PanelState>>> = {
  IDLE: { START: 'STARTING' },
  STARTING: { OBSERVE_BEGIN: 'OBSERVING', FAIL: 'FAILED', CANCEL: 'CANCELED' },
  OBSERVING: { OBSERVE_DONE: 'THINKING', FAIL: 'FAILED', CANCEL: 'CANCELED' },
  THINKING: {
    ACTION_BEGIN: 'ACTING',
    CONFIRM_REQUIRED: 'WAITING_CONFIRMATION',
    MANUAL_REQUIRED: 'WAITING_MANUAL_ACTION',
    COMPLETE: 'COMPLETED',
    FAIL: 'FAILED',
    CANCEL: 'CANCELED',
  },
  ACTING: { OBSERVE_BEGIN: 'OBSERVING', FAIL: 'FAILED', CANCEL: 'CANCELED' },
  // -> ACTING only via CONFIRM_APPROVED (docs/01 §10).
  WAITING_CONFIRMATION: {
    CONFIRM_APPROVED: 'ACTING',
    CONFIRM_DENIED: 'THINKING',
    FAIL: 'FAILED',
    CANCEL: 'CANCELED',
  },
  // Resume from a manual step always re-observes first (docs/04 §19).
  WAITING_MANUAL_ACTION: { MANUAL_DONE: 'OBSERVING', FAIL: 'FAILED', CANCEL: 'CANCELED' },
  COMPLETED: { RESET: 'IDLE' },
  FAILED: { RESET: 'IDLE' },
  CANCELED: { RESET: 'IDLE' },
};

export class IllegalTransitionError extends Error {
  constructor(
    public readonly state: PanelState,
    public readonly event: PanelEvent,
  ) {
    super(`Illegal side-panel transition: ${state} --${event}-->`);
    this.name = 'IllegalTransitionError';
  }
}

export function isTerminalState(state: PanelState): boolean {
  return TERMINAL_STATES.has(state);
}

export function transition(
  state: PanelState,
  event: PanelEvent,
  options?: { strict?: boolean },
): PanelState {
  const strict = options?.strict ?? true;
  const next = TRANSITIONS[state][event];
  if (next === undefined) {
    if (strict) {
      throw new IllegalTransitionError(state, event);
    }
    return state;
  }
  return next;
}
