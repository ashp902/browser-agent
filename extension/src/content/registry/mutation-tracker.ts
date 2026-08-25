// Mutation epoch tracking (docs/02 §17).
//
// A MutationObserver watches for changes that may affect semantic output and
// bumps a monotonically increasing epoch after a 50 ms debounce. The epoch is
// an observation hint, not a global invalidation lock (ADR-018).

export const MUTATION_DEBOUNCE_MS = 50;

const RELEVANT_ATTRIBUTES = new Set([
  'role',
  'disabled',
  'checked',
  'selected',
  'hidden',
  'style',
  'class',
  'value',
  'href',
  'alt',
  'title',
  'placeholder',
  'label',
  'for',
  'type',
  'open',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-hidden',
  'aria-expanded',
  'aria-checked',
  'aria-selected',
  'aria-disabled',
  'aria-current',
  'aria-busy',
  'aria-invalid',
  'aria-pressed',
  'aria-readonly',
  'aria-required',
]);

function isRelevantAttribute(name: string | null): boolean {
  if (name === null) return false;
  return RELEVANT_ATTRIBUTES.has(name) || name.startsWith('aria-');
}

export class MutationTracker {
  private observer: MutationObserver | null = null;
  private debounceHandle: ReturnType<typeof setTimeout> | undefined;
  private epoch = 0;

  /** Current epoch. Monotonic per document. */
  get currentEpoch(): number {
    return this.epoch;
  }

  start(root: Document | Element): void {
    if (this.observer) return;
    this.observer = new MutationObserver((mutations) => {
      if (mutations.some(isMeaningfulMutation)) {
        this.scheduleBump();
      }
    });
    this.observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.debounceHandle !== undefined) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = undefined;
    }
  }

  private scheduleBump(): void {
    if (this.debounceHandle !== undefined) {
      clearTimeout(this.debounceHandle);
    }
    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = undefined;
      this.epoch += 1;
    }, MUTATION_DEBOUNCE_MS);
  }
}

function isMeaningfulMutation(mutation: MutationRecord): boolean {
  switch (mutation.type) {
    case 'childList':
      return mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0;
    case 'characterData':
      return true;
    case 'attributes':
      return isRelevantAttribute(mutation.attributeName);
    default:
      return false;
  }
}
