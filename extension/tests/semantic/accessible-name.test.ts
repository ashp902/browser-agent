// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { computeAccessibleName, computeDescription, normalizeText } from '../../src/content/semantic/accessible-name';
import { deriveRole } from '../../src/content/semantic/roles';
import { parseDocument } from '../helpers/semantic';

function nameOf(html: string): string {
  return nameOfElement(html, 'body > *:first-child');
}

function nameOfSelector(html: string, selector: string): string {
  return nameOfElement(html, selector);
}

function nameOfElement(html: string, selector: string): string {
  const doc = parseDocument(html);
  const element = doc.querySelector(selector) as Element;
  return computeAccessibleName(element, deriveRole(element).role).name;
}

describe('normalizeText', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeText('  a \n\t b  ')).toBe('a b');
  });
});

describe('accessible name precedence', () => {
  it('prefers aria-labelledby over aria-label', () => {
    expect(
      nameOf(
        '<button aria-labelledby="lbl" aria-label="Wrong">Fallback</button><span id="lbl">Right</span>',
      ),
    ).toBe('Right');
  });

  it('uses aria-label before associated label', () => {
    expect(nameOf('<input id="f" aria-label="ARIA"><label for="f">Label text</label>')).toBe('ARIA');
  });

  it('uses explicit label[for]', () => {
    expect(nameOf('<input id="f"><label for="f">Full name</label>')).toBe('Full name');
  });

  it('uses wrapping label excluding control own value', () => {
    expect(
      nameOfSelector(
        '<label>Email address <input type="email" value="x@y.z"></label>',
        'input',
      ),
    ).toBe('Email address');
  });

  it('uses alt for images', () => {
    expect(nameOf('<img alt="Product photo">')).toBe('Product photo');
  });

  it('uses value for submit inputs', () => {
    expect(nameOf('<input type="submit" value="Pay now">')).toBe('Pay now');
  });

  it('falls back to rendered text for buttons and links', () => {
    expect(nameOf('<button> Buy now </button>')).toBe('Buy now');
    expect(nameOf('<a href="/p">Running shoes</a>')).toBe('Running shoes');
  });

  it('falls back to placeholder for textboxes only after labels fail', () => {
    expect(nameOf('<input type="text" placeholder="Search…">')).toBe('Search…');
  });

  it('uses title as final fallback for controls', () => {
    expect(nameOf('<input type="text" title="Tooltip name">')).toBe('Tooltip name');
  });

  it('normalizes whitespace inside names', () => {
    expect(nameOf('<button>  Add   to   cart </button>')).toBe('Add to cart');
  });

  it('truncates very long names at the configured limit with an ellipsis', () => {
    const long = 'a'.repeat(300);
    const name = nameOf(`<button>${long}</button>`);
    expect(name.length).toBe(200);
    expect(name.endsWith('...')).toBe(true);
  });
});

describe('description computation', () => {
  it('collects aria-describedby text separately from the name', () => {
    const doc = parseDocument(
      '<button aria-labelledby="t" aria-describedby="d">x</button><span id="t">Delete</span><span id="d">This cannot be undone.</span>',
    );
    const button = doc.body.firstElementChild as Element;
    expect(computeAccessibleName(button, deriveRole(button).role).name).toBe('Delete');
    expect(computeDescription(button).description).toBe('This cannot be undone.');
  });
});
