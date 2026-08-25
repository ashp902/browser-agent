// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MUTATION_DEBOUNCE_MS, MutationTracker } from '../../src/content/registry/mutation-tracker';
import { parseDocument } from '../helpers/semantic';

describe('mutation tracker', () => {
  let doc: Document;
  let tracker: MutationTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    doc = parseDocument('<main><p id="p">Hello</p><button>Buy</button></main>');
    tracker = new MutationTracker();
    tracker.start(doc);
  });

  afterEach(() => {
    tracker.stop();
    vi.useRealTimers();
  });

  it('starts at epoch 0', () => {
    expect(tracker.currentEpoch).toBe(0);
  });

  it('bumps after a debounced childList mutation', async () => {
    doc.querySelector('main')?.appendChild(doc.createElement('div'));
    expect(tracker.currentEpoch).toBe(0);
    await Promise.resolve();
    vi.advanceTimersByTime(MUTATION_DEBOUNCE_MS + 1);
    expect(tracker.currentEpoch).toBe(1);
  });

  it('coalesces rapid mutations into one bump', async () => {
    const main = doc.querySelector('main') as Element;
    for (let i = 0; i < 5; i += 1) {
      main.appendChild(doc.createElement('span'));
    }
    await Promise.resolve();
    vi.advanceTimersByTime(MUTATION_DEBOUNCE_MS + 1);
    expect(tracker.currentEpoch).toBe(1);
  });

  it('bumps for relevant attribute changes but not irrelevant ones', async () => {
    const button = doc.querySelector('button') as Element;
    button.setAttribute('data-irrelevant', 'x');
    await Promise.resolve();
    vi.advanceTimersByTime(MUTATION_DEBOUNCE_MS + 1);
    expect(tracker.currentEpoch).toBe(0);

    button.setAttribute('disabled', '');
    await Promise.resolve();
    vi.advanceTimersByTime(MUTATION_DEBOUNCE_MS + 1);
    expect(tracker.currentEpoch).toBe(1);

    button.setAttribute('aria-expanded', 'true');
    await Promise.resolve();
    vi.advanceTimersByTime(MUTATION_DEBOUNCE_MS + 1);
    expect(tracker.currentEpoch).toBe(2);
  });

  it('bumps for text changes', async () => {
    (doc.querySelector('#p') as Element).textContent = 'Changed';
    await Promise.resolve();
    vi.advanceTimersByTime(MUTATION_DEBOUNCE_MS + 1);
    expect(tracker.currentEpoch).toBe(1);
  });
});
