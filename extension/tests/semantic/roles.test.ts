// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { deriveRole } from '../../src/content/semantic/roles';
import { parseDocument } from '../helpers/semantic';

function roleOf(html: string): ReturnType<typeof deriveRole> {
  const doc = parseDocument(html);
  return deriveRole(doc.body.firstElementChild as Element);
}

describe('role derivation', () => {
  it('maps native interactive elements', () => {
    expect(roleOf('<button>x</button>').role).toBe('button');
    expect(roleOf('<a href="/x">x</a>').role).toBe('link');
    expect(roleOf('<a>x</a>').role).toBe('generic');
    expect(roleOf('<textarea></textarea>').role).toBe('textbox');
  });

  it('maps input types', () => {
    expect(roleOf('<input type="text">').role).toBe('textbox');
    expect(roleOf('<input type="email">').role).toBe('textbox');
    expect(roleOf('<input type="password">').role).toBe('textbox');
    expect(roleOf('<input type="search">').role).toBe('searchbox');
    expect(roleOf('<input type="checkbox">').role).toBe('checkbox');
    expect(roleOf('<input type="radio">').role).toBe('radio');
    expect(roleOf('<input type="range">').role).toBe('slider');
    expect(roleOf('<input type="number">').role).toBe('spinbutton');
    expect(roleOf('<input type="submit" value="Go">').role).toBe('button');
  });

  it('maps selects to combobox or listbox', () => {
    expect(roleOf('<select><option>a</option></select>').role).toBe('combobox');
    expect(roleOf('<select multiple><option>a</option></select>').role).toBe('listbox');
    expect(roleOf('<select size="3"><option>a</option></select>').role).toBe('listbox');
  });

  it('maps headings with levels', () => {
    expect(roleOf('<h1>t</h1>')).toMatchObject({ role: 'heading', level: 1 });
    expect(roleOf('<h6>t</h6>')).toMatchObject({ role: 'heading', level: 6 });
  });

  it('prefers valid explicit ARIA roles', () => {
    const doc = parseDocument('<div role="button">x</div>');
    expect(deriveRole(doc.body.firstElementChild as Element)).toMatchObject({
      role: 'button',
      explicit: true,
    });
    // Explicit heading level honored via aria-level.
    expect(
      deriveRole(
        parseDocument('<div role="heading" aria-level="3">x</div>').body.firstElementChild as Element,
      ),
    ).toMatchObject({ role: 'heading', level: 3 });
  });

  it('falls through to native mapping for unsupported role tokens', () => {
    const doc = parseDocument('<button role="wibble">x</button>');
    expect(deriveRole(doc.body.firstElementChild as Element).role).toBe('button');
  });

  it('maps structure', () => {
    expect(roleOf('<main></main>').role).toBe('main');
    expect(roleOf('<nav></nav>').role).toBe('navigation');
    expect(roleOf('<form></form>').role).toBe('form');
    expect(roleOf('<fieldset></fieldset>').role).toBe('group');
    expect(roleOf('<ul><li>x</li></ul>').role).toBe('list');
    expect(roleOf('<table><tr><td>x</td></tr></table>').role).toBe('table');
    expect(roleOf('<section aria-label="S"></section>').role).toBe('region');
    expect(roleOf('<section></section>').role).toBe('generic');
  });

  it('determines header cell direction', () => {
    const doc = parseDocument(
      '<table><thead><tr><th>Name</th><th>Age</th></tr></thead>' +
        '<tbody><tr><th scope="row">Alice</th><td>30</td></tr></tbody></table>',
    );
    const table = doc.querySelector('table') as HTMLTableElement;
    const [headRow, bodyRow] = Array.from(table.querySelectorAll('tr'));
    expect(deriveRole(headRow.children[0]).role).toBe('columnheader');
    expect(deriveRole(headRow.children[1]).role).toBe('columnheader');
    expect(deriveRole(bodyRow.children[0]).role).toBe('rowheader');
  });
});
