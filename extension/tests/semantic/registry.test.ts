// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { ElementRegistry } from '../../src/content/registry/element-registry';
import { parseDocument } from '../helpers/semantic';

describe('element registry', () => {
  it('assigns a stable ID for the same element', () => {
    const doc = parseDocument('<button>A</button><button>B</button>');
    const registry = new ElementRegistry();
    const [a, b] = Array.from(doc.querySelectorAll('button'));
    const idA1 = registry.getOrAssignId(a);
    const idA2 = registry.getOrAssignId(a);
    expect(idA1).toBe(idA2);
    expect(registry.getOrAssignId(b)).not.toBe(idA1);
  });

  it('assigns monotonic IDs without reuse', () => {
    const doc = parseDocument('<ul>' + '<li>x</li>'.repeat(5) + '</ul>');
    const registry = new ElementRegistry();
    const ids = Array.from(doc.querySelectorAll('li')).map((li) => registry.getOrAssignId(li));
    expect(ids).toEqual([1, 2, 3, 4, 5]);
  });

  it('resolves registered IDs to their live element', () => {
    const doc = parseDocument('<button>target</button>');
    const registry = new ElementRegistry();
    const button = doc.querySelector('button') as Element;
    const id = registry.getOrAssignId(button);
    expect(registry.resolve(id)).toBe(button);
    expect(registry.resolve(9999)).toBeUndefined();
  });

  it('reports lookups without assigning IDs', () => {
    const doc = parseDocument('<button>x</button>');
    const registry = new ElementRegistry();
    const button = doc.querySelector('button') as Element;
    expect(registry.lookup(button)).toBeUndefined();
    expect(registry.size).toBe(0);
    registry.getOrAssignId(button);
    expect(registry.lookup(button)).toBeDefined();
  });
});
