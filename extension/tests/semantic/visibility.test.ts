// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { createVisibilityContext, isSemanticallyHidden } from '../../src/content/semantic/visibility';
import { parseDocument } from '../helpers/semantic';

function hiddenIn(html: string, selector = 'body > *:first-child'): boolean {
  const doc = parseDocument(html);
  const element = doc.querySelector(selector) as Element;
  return isSemanticallyHidden(element, createVisibilityContext(doc));
}

describe('semantic visibility', () => {
  it('treats ordinary elements as visible', () => {
    expect(hiddenIn('<button>Buy</button>')).toBe(false);
  });

  it('hides elements with the hidden attribute', () => {
    expect(hiddenIn('<div hidden><button>Buy</button></div>', 'button')).toBe(true);
    expect(hiddenIn('<button hidden>x</button>')).toBe(true);
  });

  it('hides aria-hidden subtrees', () => {
    expect(hiddenIn('<div aria-hidden="true"><button>x</button></div>', 'button')).toBe(true);
  });

  it('hides display:none and visibility:hidden elements via computed style', () => {
    expect(hiddenIn('<div style="display:none"><button>x</button></div>', 'button')).toBe(true);
    expect(
      hiddenIn('<div style="display:none"><span><button>x</button></span></div>', 'button'),
    ).toBe(true);
    expect(hiddenIn('<div style="visibility:hidden"><button>x</button></div>', 'button')).toBe(true);
  });

  it('keeps summary visible inside closed details but hides the rest', () => {
    const html =
      '<details><summary>Show more</summary><p>Details body</p><button>Hidden action</button></details>';
    expect(hiddenIn(html, 'summary')).toBe(false);
    expect(hiddenIn(html, 'button')).toBe(true);
    expect(hiddenIn(html, 'p')).toBe(true);
  });

  it('hides closed dialogs and keeps open dialogs visible', () => {
    const html =
      '<dialog id="closed"><button>A</button></dialog><dialog open id="open"><button>B</button></dialog>';
    expect(hiddenIn(html, '#closed button')).toBe(true);
    expect(hiddenIn(html, '#open button')).toBe(false);
  });
});
