// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { buildPage } from '../helpers/semantic';

describe('compact serializer', () => {
  it('renders the PAGE header with fixed volatile fields when overridden', () => {
    const { text } = buildPage('<title>Shop</title><button>Buy</button>');
    expect(text.startsWith('PAGE title="Shop" url="https://shop.example/" snapshot="test-snapshot-id" epoch=0\n')).toBe(
      true,
    );
  });

  it('uses two-space indentation and @id markers in document order', () => {
    const { text } = buildPage(
      '<main><section aria-label="Results">' +
        '<div class="card"><h2>Shoe</h2><button>Buy</button></div>' +
        '<div class="card"><h2>Boot</h2><button>Buy</button></div>' +
        '</section></main>',
    );
    const lines = text.trimEnd().split('\n').slice(2);
    expect(lines[0]).toMatch(/^MAIN @\d+$/);
    expect(lines[1]).toMatch(/^ {2}REGION @\d+ "Results"$/);
    expect(lines[2]).toMatch(/^ {4}GROUP @\d+$/);
    expect(lines[3]).toMatch(/^ {6}H2 "Shoe"$/);
    expect(lines[4]).toMatch(/^ {6}BUTTON @\d+ "Buy"$/);
  });

  it('escapes quotes using JSON rules and omits empty fields', () => {
    const { text } = buildPage('<button>He said "hi"</button>');
    expect(text).toContain('BUTTON @');
    expect(text).toContain('"He said \\"hi\\""');
  });

  it('renders states compactly', () => {
    const { text } = buildPage(
      '<button disabled>Out of stock</button>' +
        '<details open><summary>x</summary></details>' +
        '<input type="text" aria-invalid="true" required>',
    );
    expect(text).toContain('[disabled]');
    expect(text).toContain('[required invalid]');
  });

  it('prints select options with selection state', () => {
    const { text } = buildPage(
      '<label>Size <select id="s"><option value="9">9</option><option value="10" selected>10</option></select></label>',
    );
    expect(text).toContain('COMBOBOX @');
    expect(text).toContain('OPTION "9" value="9"');
    expect(text).toContain('OPTION "10" value="10" [selected]');
  });

  it('caps long option lists at the configured budget', () => {
    const options = Array.from({ length: 60 }, (_, i) => `<option value="${i}">Opt ${i}</option>`).join('');
    const { text } = buildPage(`<select>${options}<option value="59" selected>Opt 59</option></select>`);
    const optionLines = text.split('\n').filter((line) => line.includes('OPTION '));
    // First 20, selected, last 5, plus the omission marker.
    expect(optionLines.length).toBeLessThanOrEqual(27);
    expect(text).toContain('options not shown');
    expect(optionLines.some((line) => line.includes('[selected]'))).toBe(true);
  });

  it('never emits CSS classes, selectors, styles, or coordinates', () => {
    const { text } = buildPage(
      '<div class="fancy wrapper" style="color:red"><button style="margin:0px">Buy</button></div>',
    );
    expect(text).not.toContain('fancy');
    expect(text).not.toContain('wrapper');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('margin');
  });
});
