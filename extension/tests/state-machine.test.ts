import { describe, expect, it } from 'vitest';

import {
  IllegalTransitionError,
  isTerminalState,
  transition,
  type PanelEvent,
  type PanelState,
} from '../src/sidepanel/state/machine';

function path(events: PanelEvent[], start: PanelState = 'IDLE'): PanelState {
  return events.reduce<PanelState>((state, event) => transition(state, event), start);
}

describe('side-panel state machine', () => {
  it('walks the canonical observe-think-act loop', () => {
    expect(path(['START'])).toBe('STARTING');
    expect(path(['START', 'OBSERVE_BEGIN'])).toBe('OBSERVING');
    expect(path(['START', 'OBSERVE_BEGIN', 'OBSERVE_DONE'])).toBe('THINKING');
    expect(path(['START', 'OBSERVE_BEGIN', 'OBSERVE_DONE', 'ACTION_BEGIN'])).toBe('ACTING');
    // ACTING -> OBSERVING after every state-changing action (docs/00 §2.2).
    expect(path(['START', 'OBSERVE_BEGIN', 'OBSERVE_DONE', 'ACTION_BEGIN', 'OBSERVE_BEGIN'])).toBe('OBSERVING');
  });

  it('allows confirmation only through an affirmative response', () => {
    const waiting = path(['START', 'OBSERVE_BEGIN', 'OBSERVE_DONE', 'CONFIRM_REQUIRED']);
    expect(waiting).toBe('WAITING_CONFIRMATION');
    expect(transition(waiting, 'CONFIRM_APPROVED')).toBe('ACTING');
    expect(transition(waiting, 'CONFIRM_DENIED')).toBe('THINKING');
    expect(() => transition(waiting, 'OBSERVE_BEGIN')).toThrow(IllegalTransitionError);
  });

  it('routes manual steps through re-observation', () => {
    const waiting = path(['START', 'OBSERVE_BEGIN', 'OBSERVE_DONE', 'MANUAL_REQUIRED']);
    expect(waiting).toBe('WAITING_MANUAL_ACTION');
    expect(transition(waiting, 'MANUAL_DONE')).toBe('OBSERVING');
  });

  it('supports completion from THINKING only', () => {
    expect(path(['START', 'OBSERVE_BEGIN', 'OBSERVE_DONE', 'COMPLETE'])).toBe('COMPLETED');
    expect(() => transition('ACTING', 'COMPLETE')).toThrow(IllegalTransitionError);
  });

  it('allows cancel/fail from any active state', () => {
    const activeStates: PanelState[] = [
      'STARTING',
      'OBSERVING',
      'THINKING',
      'ACTING',
      'WAITING_CONFIRMATION',
      'WAITING_MANUAL_ACTION',
    ];
    for (const state of activeStates) {
      expect(transition(state, 'CANCEL')).toBe('CANCELED');
      expect(transition(state, 'FAIL')).toBe('FAILED');
    }
  });

  it('rejects spec-listed illegal transitions', () => {
    // docs/01 §10: COMPLETED -> ACTING is invalid.
    expect(() => transition('COMPLETED', 'ACTION_BEGIN')).toThrow(IllegalTransitionError);
    expect(() => transition('IDLE', 'OBSERVE_DONE')).toThrow(IllegalTransitionError);
    expect(() => transition('IDLE', 'CANCEL')).toThrow(IllegalTransitionError);
    expect(() => transition('CANCELED', 'START')).toThrow(IllegalTransitionError);
  });

  it('resets only from terminal states', () => {
    expect(transition('COMPLETED', 'RESET')).toBe('IDLE');
    expect(transition('FAILED', 'RESET')).toBe('IDLE');
    expect(transition('CANCELED', 'RESET')).toBe('IDLE');
    expect(() => transition('THINKING', 'RESET')).toThrow(IllegalTransitionError);
  });

  it('ignores illegal transitions instead of throwing when not strict', () => {
    expect(transition('COMPLETED', 'ACTION_BEGIN', { strict: false })).toBe('COMPLETED');
  });

  it('knows terminal states', () => {
    expect(isTerminalState('COMPLETED')).toBe(true);
    expect(isTerminalState('THINKING')).toBe(false);
  });
});
