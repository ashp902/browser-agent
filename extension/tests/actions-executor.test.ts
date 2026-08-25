// @vitest-environment jsdom
// Executor unit tests per docs/03 §21.

import { describe, expect, it } from 'vitest';

import {
  IdempotencyCache,
  executeAction,
  type ExecutionContext,
} from '../src/content/actions/executor';
import { resolveNavigationUrl } from '../src/content/actions/navigation';
import { computeScrollByPixels } from '../src/content/actions/scroll';
import { ElementRegistry } from '../src/content/registry/element-registry';
import { MutationTracker } from '../src/content/registry/mutation-tracker';
import { buildPageSnapshot } from '../src/content/semantic/extractor';
import type { PageSnapshot } from '../src/content/semantic/types';
import type { ActionResult, BrowserActionRequest, BrowserToolName } from '../src/shared/action-protocol';
import type { SemanticFingerprint } from '../src/shared/semantic-contracts';
import { parseDocument } from './helpers/semantic';

interface Setup {
  doc: Document;
  ctx: ExecutionContext;
  snapshot: PageSnapshot;
}

function setup(html: string): Setup {
  const doc = parseDocument(`<title>T</title>${html}`);
  const registry = new ElementRegistry();
  const tracker = new MutationTracker();
  const ctx: ExecutionContext = {
    doc,
    documentId: 'doc-1',
    registry,
    tracker,
    idempotency: new IdempotencyCache(),
  };
  const snapshot = buildPageSnapshot(doc, {
    documentId: 'doc-1',
    mutationEpoch: 0,
    registry,
    snapshotId: 'snap',
    capturedAtMs: 0,
  });
  return { doc, ctx, snapshot };
}

/** Collects the actionable fingerprints exactly like the wire payload does. */
function fingerprintsOf(snapshot: PageSnapshot): Record<number, SemanticFingerprint> {
  const map: Record<number, SemanticFingerprint> = {};
  for (const node of Object.values(snapshot.nodes)) {
    if (node.element_id !== undefined && node.fingerprint) {
      map[node.element_id] = { ...node.fingerprint };
    }
  }
  return map;
}

let nextActionId = 1;

function makeRequest(
  tool: BrowserToolName,
  args: Record<string, unknown>,
  options?: Partial<Pick<BrowserActionRequest, 'document_id' | 'observed_mutation_epoch'>> & {
    expected?: SemanticFingerprint;
    reuseActionId?: string;
  },
): BrowserActionRequest {
  const request: BrowserActionRequest = {
    protocol_version: 1,
    action_id: options?.reuseActionId ?? `action-${nextActionId++}`,
    document_id: options?.document_id ?? 'doc-1',
    observed_mutation_epoch: options?.observed_mutation_epoch ?? 0,
    tool,
    args,
  };
  if (options?.expected !== undefined) {
    request.expected_target = options.expected;
  }
  return request;
}

const TWO_CARDS = `
  <section aria-label="Results">
    <div class="product-card">
      <h2>Nike Pegasus</h2>
      <button>Buy</button>
    </div>
    <div class="product-card">
      <h2>Adidas Ultraboost</h2>
      <button>Buy</button>
    </div>
  </section>`;

describe('click_element', () => {
  it('clicks the chosen repeated Buy button by element ID', () => {
    const { doc, ctx, snapshot } = setup(TWO_CARDS);
    const buttons = Array.from(doc.querySelectorAll('button'));
    const clicked: string[] = [];
    buttons.forEach((button, index) =>
      button.addEventListener('click', () => clicked.push(`card-${index}`)),
    );

    const fingerprints = fingerprintsOf(snapshot);
    const secondCardButtonId = ctx.registry.lookup(buttons[1])!;
    expect(fingerprints[secondCardButtonId].normalized_name).toBe('buy');

    const result = executeAction(
      makeRequest('click_element', { element_id: secondCardButtonId }, { expected: fingerprints[secondCardButtonId] }),
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(clicked).toEqual(['card-1']);
    expect(result.summary).toContain('Buy');
  });

  it('rejects unknown element IDs as TARGET_NOT_FOUND', () => {
    const { ctx } = setup('<button>Buy</button>');
    const result = executeAction(makeRequest('click_element', { element_id: 9999 }), ctx);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('TARGET_NOT_FOUND');
    expect(result.error?.retryable).toBe(true);
  });

  it('rejects disabled targets as TARGET_DISABLED', () => {
    const { ctx, snapshot } = setup('<button disabled>Sold out</button>');
    const id = actionableIds(snapshot)[0];
    const result = executeAction(makeRequest('click_element', { element_id: id }), ctx);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('TARGET_DISABLED');
  });

  it('rejects targets hidden after observation as TARGET_NOT_VISIBLE', () => {
    const { doc, ctx, snapshot } = setup('<button>Ghost</button>');
    const id = actionableIds(snapshot)[0];
    // The element was visible when observed; hide it before acting.
    doc.querySelector('button')!.style.display = 'none';
    const result = executeAction(makeRequest('click_element', { element_id: id }), ctx);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('TARGET_NOT_VISIBLE');
  });

  it('never registers elements that were hidden at observation time', () => {
    const { snapshot } = setup('<div style="display:none"><button>Ghost</button></div>');
    expect(actionableIds(snapshot)).toEqual([]);
  });

  it('rejects non-actionable containers as UNSUPPORTED_TARGET', () => {
    const { ctx, snapshot } = setup('<form><button>Go</button></form>');
    const formNode = Object.values(snapshot.nodes).find((n) => n.role === 'form');
    const result = executeAction(makeRequest('click_element', { element_id: formNode?.element_id }), ctx);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('UNSUPPORTED_TARGET');
  });
});

describe('target revalidation (docs/03 §6-§7)', () => {
  it('fails with STALE_TARGET when the accessible name changed after observation', () => {
    const { doc, ctx, snapshot } = setup(TWO_CARDS);
    const fingerprints = fingerprintsOf(snapshot);
    const buttonId = actionableIds(snapshot)[0];

    doc.querySelector('button')!.textContent = 'Bought out';
    const result = executeAction(makeRequest('click_element', { element_id: buttonId }, { expected: fingerprints[buttonId] }), ctx);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('STALE_TARGET');
    expect(result.error?.message).toContain('Observe the page again');
  });

  it('does NOT reject for unrelated DOM mutation plus epoch mismatch (ADR-018)', () => {
    const { doc, ctx, snapshot } = setup(TWO_CARDS);
    const fingerprints = fingerprintsOf(snapshot);
    const buttons = Array.from(doc.querySelectorAll('button'));
    const secondButtonId = ctx.registry.lookup(buttons[1])!;
    let clicks = 0;
    buttons[1].addEventListener('click', () => (clicks += 1));

    doc.body.appendChild(doc.createElement('div')); // unrelated mutation

    const result = executeAction(
      makeRequest('click_element', { element_id: secondButtonId }, { expected: fingerprints[secondButtonId], observed_mutation_epoch: 99 }),
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(clicks).toBe(1);
  });

  it('fails with DOCUMENT_CHANGED for a foreign document ID without touching DOM', () => {
    const { doc, ctx } = setup('<button>Buy</button>');
    let clicks = 0;
    doc.querySelector('button')!.addEventListener('click', () => (clicks += 1));
    const result = executeAction(makeRequest('click_element', { element_id: 1 }, { document_id: 'other-doc' }), ctx);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('DOCUMENT_CHANGED');
    expect(clicks).toBe(0);
  });

  it('deduplicates repeated action IDs (docs/03 §17)', () => {
    const { doc, ctx, snapshot } = setup('<button>Buy</button>');
    let clicks = 0;
    doc.querySelector('button')!.addEventListener('click', () => (clicks += 1));
    const buttonId = actionableIds(snapshot)[0];

    const first = makeRequest('click_element', { element_id: buttonId });
    const second: BrowserActionRequest = JSON.parse(JSON.stringify(first));
    const r1 = executeAction(first, ctx);
    const r2 = executeAction(second, ctx);
    expect(r1.ok).toBe(true);
    expect(r2).toEqual(r1);
    expect(clicks).toBe(1);
  });
});

describe('set_text', () => {
  it('sets value via the native prototype setter and dispatches input then change', () => {
    const { doc, ctx, snapshot } = setup('<form aria-label="F"><label for="q">Query</label><input id="q"></form>');
    const input = doc.querySelector('input')!;
    const events: string[] = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));

    // Wrap the prototype of the ELEMENT'S OWN REALM (each JSDOM instance has
    // its own constructors), the way a framework value tracker would.
    const realmProto = Object.getPrototypeOf(input);
    const originalDescriptor = Object.getOwnPropertyDescriptor(realmProto, 'value')!;
    const nativeSetter = originalDescriptor.set!;
    const setterCalls: string[] = [];
    const nativeGetter = originalDescriptor.get as () => string;
    Object.defineProperty(realmProto, 'value', {
      configurable: true,
      get: nativeGetter,
      set: function (this: HTMLInputElement, v: string) {
        setterCalls.push(v);
        nativeSetter.call(this, v);
      },
    });

    try {
      const id = actionableIds(snapshot)[0];
      const result = executeAction(makeRequest('set_text', { element_id: id, text: 'running shoes' }, { expected: fingerprintsOf(snapshot)[id] }), ctx);
      expect(result.ok).toBe(true);
      expect(result.changed).toBe(true);
      expect(result.data?.value_length).toBe(13);
      expect(setterCalls).toEqual(['running shoes']);
      expect(events).toEqual(['input', 'change']);
      expect((input as HTMLInputElement).value).toBe('running shoes');
    } finally {
      Object.defineProperty(realmProto, 'value', originalDescriptor);
    }
  });

  it('works for textareas', () => {
    const { ctx, snapshot } = setup('<label for="bio">Bio</label><textarea id="bio"></textarea>');
    const id = actionableIds(snapshot)[0];
    const result = executeAction(makeRequest('set_text', { element_id: id, text: 'hello' }), ctx);
    expect(result.ok).toBe(true);
  });

  it('refuses password fields as manual-only even with a bound fingerprint', () => {
    const html = '<label for="pw">Password</label><input id="pw" type="password">';
    const { ctx, snapshot } = setup(html);
    const id = actionableIds(snapshot)[0];
    const result = executeAction(makeRequest('set_text', { element_id: id, text: 'hunter2' }, { expected: fingerprintsOf(snapshot)[id] }), ctx);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('UNSUPPORTED_TARGET');
  });

  it('refuses read-only inputs as TARGET_DISABLED', () => {
    const { ctx, snapshot } = setup('<input id="ro" readonly aria-label="Code">');
    const id = actionableIds(snapshot)[0];
    const result = executeAction(makeRequest('set_text', { element_id: id, text: 'x' }), ctx);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('TARGET_DISABLED');
  });

  it('rejects non-text targets', () => {
    const { ctx, snapshot } = setup('<button>Buy</button>');
    const id = actionableIds(snapshot)[0];
    const result = executeAction(makeRequest('set_text', { element_id: id, text: 'x' }), ctx);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('UNSUPPORTED_TARGET');
  });
});

describe('select_option', () => {
  const SELECT_HTML =
    '<label for="size">Size</label><select id="size">' +
    '<option value="">Choose…</option>' +
    '<option value="9">Size 9</option>' +
    '<option value="10">Size 10</option>' +
    '<option value="10.5">Size 10</option>' +
    '</select>';

  it('selects by value and dispatches input/change', () => {
    const { doc, ctx, snapshot } = setup(SELECT_HTML);
    const select = doc.querySelector('select')!;
    const events: string[] = [];
    select.addEventListener('change', () => events.push('change'));

    const id = actionableIds(snapshot)[0];
    const result = executeAction(makeRequest('select_option', { element_id: id, option_value: '10' }), ctx);
    expect(result.ok).toBe(true);
    expect(events).toEqual(['change']);
    expect((select as HTMLSelectElement).value).toBe('10');
    expect(result.data).toMatchObject({ value: '10' });
  });

  it('selects by exact normalized label when unambiguous', () => {
    const unambiguous = SELECT_HTML.replace('<option value="10.5">Size 10</option>', '');
    const { doc, ctx, snapshot } = setup(unambiguous);
    const select = doc.querySelector('select')!;
    const id = actionableIds(snapshot)[0];
    const result = executeAction(makeRequest('select_option', { element_id: id, option_label: ' size  10 ' }), ctx);
    expect(result.ok).toBe(true);
    expect((select as HTMLSelectElement).value).toBe('10');
  });

  it('rejects ambiguous labels', () => {
    const { ctx, snapshot } = setup(SELECT_HTML);
    const id = actionableIds(snapshot)[0];
    const result = executeAction(makeRequest('select_option', { element_id: id, option_label: 'Size 10' }), ctx);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_ARGUMENT');
  });

  it('rejects unmatched and disabled options', () => {
    const withDisabled =
      '<select aria-label="Color"><option value="red" disabled>Red</option><option value="blue">Blue</option></select>';
    const { ctx, snapshot } = setup(withDisabled);
    const id = actionableIds(snapshot)[0];

    const missing = executeAction(makeRequest('select_option', { element_id: id, option_value: 'green' }), ctx);
    expect(missing.error?.code).toBe('INVALID_ARGUMENT');

    const disabledMatch = executeAction(makeRequest('select_option', { element_id: id, option_value: 'red' }), ctx);
    expect(disabledMatch.error?.code).toBe('INVALID_ARGUMENT');
  });

  it('refuses custom comboboxes', () => {
    const { ctx, snapshot } = setup('<div role="combobox" aria-label="State" tabindex="0"></div>');
    const id = actionableIds(snapshot)[0];
    const result = executeAction(makeRequest('select_option', { element_id: id, option_value: 'tx' }), ctx);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('UNSUPPORTED_TARGET');
  });
});

describe('set_checked', () => {
  it('toggles checkboxes and skips clicking when state already matches', () => {
    const { doc, ctx, snapshot } = setup('<input type="checkbox" aria-label="Gift wrap">');
    const checkbox = doc.querySelector('input')!;
    let clicks = 0;
    checkbox.addEventListener('click', () => (clicks += 1));
    const id = actionableIds(snapshot)[0];

    const check = executeAction(makeRequest('set_checked', { element_id: id, checked: true }), ctx);
    expect(check.ok).toBe(true);
    expect(check.changed).toBe(true);
    expect((checkbox as HTMLInputElement).checked).toBe(true);

    const again = executeAction(makeRequest('set_checked', { element_id: id, checked: true }), ctx);
    expect(again.ok).toBe(true);
    expect(again.changed).toBe(false);
    expect(clicks).toBe(1);

    const uncheck = executeAction(makeRequest('set_checked', { element_id: id, checked: false }), ctx);
    expect(uncheck.ok).toBe(true);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it('allows radios only toward checked', () => {
    const { ctx, snapshot } = setup('<input type="radio" aria-label="Express shipping">');
    const id = actionableIds(snapshot)[0];

    const off = executeAction(makeRequest('set_checked', { element_id: id, checked: false }), ctx);
    expect(off.ok).toBe(false);
    expect(off.error?.code).toBe('UNSUPPORTED_TARGET');

    const on = executeAction(makeRequest('set_checked', { element_id: id, checked: true }), ctx);
    expect(on.ok).toBe(true);
  });

  it('refuses non-checkable targets', () => {
    const { ctx, snapshot } = setup('<button>Buy</button>');
    const id = actionableIds(snapshot)[0];
    const result = executeAction(makeRequest('set_checked', { element_id: id, checked: true }), ctx);
    expect(result.error?.code).toBe('UNSUPPORTED_TARGET');
  });
});

describe('press_key', () => {
  it('dispatches keydown/keyup with deterministic codes on the target', () => {
    const { doc, ctx, snapshot } = setup('<input aria-label="Search box">');
    const input = doc.querySelector('input')!;
    const received: string[] = [];
    input.addEventListener('keydown', (e) => received.push(`keydown:${e.key}:${e.keyCode}`));
    input.addEventListener('keyup', (e) => received.push(`keyup:${e.key}`));
    const id = actionableIds(snapshot)[0];

    const result = executeAction(makeRequest('press_key', { element_id: id, key: 'Enter' }), ctx);
    expect(result.ok).toBe(true);
    expect(received).toEqual(['keydown:Enter:13', 'keyup:Enter']);
  });

  it('rejects arbitrary keys and modifiers', () => {
    const { ctx } = setup('<button>x</button>');
    const result = executeAction(makeRequest('press_key', { key: 'a' }), ctx);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_ARGUMENT');
  });

  it('falls back to the active element when no target is given', () => {
    const { doc, ctx } = setup('<button id="b">x</button>');
    const button = doc.querySelector('button')!;
    button.focus();
    const received: string[] = [];
    button.addEventListener('keydown', (e) => received.push(e.key));
    const result = executeAction(makeRequest('press_key', { key: 'Escape' }), ctx);
    expect(result.ok).toBe(true);
    expect(received).toEqual(['Escape']);
  });
});

describe('scroll tools', () => {
  it('computes deterministic viewport-relative amounts (docs/03 §13)', () => {
    expect(computeScrollByPixels('down', 'small', 1000)).toBe(350);
    expect(computeScrollByPixels('down', undefined, 1000)).toBe(750);
    expect(computeScrollByPixels('up', 'large', 1000)).toBe(-1250);
  });

  it('validates direction and amount arguments', () => {
    const { ctx } = setup('<main></main>');
    expect(executeAction(makeRequest('scroll_page', { direction: 'sideways' }), ctx).error?.code).toBe('INVALID_ARGUMENT');
    expect(executeAction(makeRequest('scroll_page', { direction: 'down', amount: 'huge' }), ctx).error?.code).toBe('INVALID_ARGUMENT');
    expect(executeAction(makeRequest('scroll_page', { direction: 'down' }), ctx).ok).toBe(true);
  });

  it('refuses non-scrollable containers', () => {
    const { ctx, snapshot } = setup('<section aria-label="Box"><p>short</p></section>');
    const regionId = Object.values(snapshot.nodes).find((n) => n.role === 'region')?.element_id;
    const result = executeAction(
      makeRequest('scroll_element', { element_id: regionId as number, direction: 'down' }),
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('UNSUPPORTED_TARGET');
  });
});

describe('navigation tools', () => {
  it('blocks every forbidden scheme (docs/03 §15)', () => {
    const { ctx } = setup('<main></main>');
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<h1>x</h1>',
      'file:///etc/passwd',
      'chrome://extensions',
      'blob:https://shop.example/id',
    ]) {
      const result = executeAction(makeRequest('navigate_current_tab', { url: bad }), ctx);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('NAVIGATION_BLOCKED');
    }
  });

  it('resolves relative URLs against the current document before validation', () => {
    expect(resolveNavigationUrl('https://shop.example/products?q=shoe', 'cart')).toBe(
      'https://shop.example/cart',
    );
    expect(resolveNavigationUrl('https://shop.example/products', '/orders')).toBe(
      'https://shop.example/orders',
    );
    expect(resolveNavigationUrl('https://shop.example/', 'javascript:void(0)')).toBeNull();
    expect(resolveNavigationUrl('https://shop.example/', '')).toBeNull();
  });

  it('returns a no-op result when there is no history entry (docs/03 §16)', () => {
    const { ctx } = setup('<main></main>');
    // Fresh jsdom window has a single history entry.
    if (ctx.doc.defaultView && ctx.doc.defaultView.history.length <= 1) {
      const result = executeAction(makeRequest('go_back', {}), ctx);
      expect(result.ok).toBe(true);
      expect(result.changed).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers shared across suites
// ---------------------------------------------------------------------------

function actionableIds(snapshot: PageSnapshot): number[] {
  return Object.values(snapshot.nodes)
    .filter((node) => node.element_id !== undefined && node.fingerprint !== undefined)
    .map((node) => node.element_id as number);
}

describe('action result contract', () => {
  it('always returns a structured result with epochs and ids', () => {
    const { ctx, snapshot } = setup('<button>Buy</button>');
    const result: ActionResult | undefined = executeAction(
      makeRequest('click_element', { element_id: actionableIds(snapshot)[0] }),
      ctx,
    );
    expect(result.protocol_version).toBe(1);
    expect(result.document_id).toBe('doc-1');
    expect(typeof result.mutation_epoch_before).toBe('number');
    expect(typeof result.mutation_epoch_after).toBe('number');
    expect(typeof result.summary).toBe('string');
  });
});
