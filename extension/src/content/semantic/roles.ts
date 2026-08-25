// Role derivation (docs/02 §6).
//
// Precedence: (1) valid explicit ARIA role token supported by our map,
// (2) native HTML implicit mapping, (3) structural inference (grouping.ts),
// (4) generic when retained only for hierarchy.

import type { SemanticRole } from './types';

const EXPLICIT_ROLE_MAP: Record<string, SemanticRole> = {
  main: 'main',
  navigation: 'navigation',
  region: 'region',
  form: 'form',
  group: 'group',
  dialog: 'dialog',
  alertdialog: 'alertdialog',
  heading: 'heading',
  paragraph: 'paragraph',
  link: 'link',
  button: 'button',
  textbox: 'textbox',
  searchbox: 'searchbox',
  checkbox: 'checkbox',
  radio: 'radio',
  switch: 'switch',
  combobox: 'combobox',
  listbox: 'listbox',
  option: 'option',
  slider: 'slider',
  spinbutton: 'spinbutton',
  tablist: 'tablist',
  tab: 'tab',
  tabpanel: 'tabpanel',
  menu: 'menu',
  menuitem: 'menuitem',
  list: 'list',
  listitem: 'listitem',
  table: 'table',
  rowgroup: 'rowgroup',
  row: 'row',
  columnheader: 'columnheader',
  rowheader: 'rowheader',
  cell: 'cell',
  img: 'image',
  separator: 'separator',
  generic: 'generic',
};

// Input types that behave as text-entry controls (docs/02 §6).
const TEXTBOX_INPUT_TYPES = new Set(['text', 'email', 'tel', 'url', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week']);

const BUTTON_INPUT_TYPES = new Set(['submit', 'reset', 'button', 'image']);

export interface DerivedRole {
  role: SemanticRole;
  /** Heading level for heading roles. */
  level?: number;
  /** True when the role came from an explicit ARIA role token. */
  explicit: boolean;
}

export function deriveRole(element: Element): DerivedRole {
  const explicitToken = (element.getAttribute('role') ?? '').trim().split(/\s+/)[0];
  if (explicitToken && explicitToken in EXPLICIT_ROLE_MAP) {
    const role = EXPLICIT_ROLE_MAP[explicitToken];
    const derived: DerivedRole = { role, explicit: true };
    if (role === 'heading') {
      const level = Number.parseInt(element.getAttribute('aria-level') ?? '', 10);
      derived.level = Number.isInteger(level) && level >= 1 && level <= 6 ? level : 2;
    }
    return derived;
  }
  return { ...nativeRole(element), explicit: false };
}

function nativeRole(element: Element): { role: SemanticRole; level?: number } {
  const tag = element.tagName;

  if (tag === 'MAIN') return { role: 'main' };
  if (tag === 'NAV') return { role: 'navigation' };
  if (tag === 'FORM') return { role: 'form' };
  if (tag === 'FIELDSET') return { role: 'group' };
  if (tag === 'DIALOG') return { role: 'dialog' };
  if (tag === 'SECTION') {
    // A section maps to region only when labeled; otherwise it is structural
    // filler and may be retained as generic for hierarchy.
    return { role: hasAccessibleLabelHint(element) ? 'region' : 'generic' };
  }
  if (tag === 'ARTICLE') {
    // Labeled articles are exposed as regions within our role vocabulary;
    // unlabeled ones remain structural generics.
    return { role: hasAccessibleLabelHint(element) ? 'region' : 'generic' };
  }
  if (tag === 'UL' || tag === 'OL') return { role: 'list' };
  if (tag === 'LI') return { role: 'listitem' };
  if (tag === 'TABLE') return { role: 'table' };
  if (tag === 'THEAD' || tag === 'TBODY' || tag === 'TFOOT') return { role: 'rowgroup' };
  if (tag === 'TR') return { role: 'row' };
  if (tag === 'TH') return { role: headerCellRole(element) };
  if (tag === 'TD') return { role: 'cell' };
  if (tag === 'IMG') return { role: 'image' };
  if (tag === 'HR') return { role: 'separator' };
  if (tag === 'P') return { role: 'paragraph' };
  if (tag === 'TEXTAREA') return { role: 'textbox' };
  if (tag === 'SELECT') return { role: selectRole(element) };
  if (tag === 'OPTION') return { role: 'option' };

  if (tag === 'A') {
    return { role: element.hasAttribute('href') ? 'link' : 'generic' };
  }
  if (tag === 'BUTTON') return { role: 'button' };

  if (/^H[1-6]$/.test(tag)) {
    return { role: 'heading', level: Number.parseInt(tag.charAt(1), 10) };
  }

  if (tag === 'INPUT') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'search') return { role: 'searchbox' };
    if (type === 'checkbox') return { role: 'checkbox' };
    if (type === 'radio') return { role: 'radio' };
    if (type === 'range') return { role: 'slider' };
    if (type === 'number') return { role: 'spinbutton' };
    if (TEXTBOX_INPUT_TYPES.has(type)) return { role: 'textbox' };
    if (BUTTON_INPUT_TYPES.has(type)) return { role: 'button' };
    if (type === 'hidden' || type === 'file') {
      // Hidden inputs carry no semantics; file inputs are manual-only
      // (docs/06 §6.1) and are surfaced as generic controls with state.
      return { role: 'generic' };
    }
    return { role: 'textbox' };
  }

  if ((element as HTMLElement).isContentEditable === true) {
    // Contenteditable surfaces as a textbox; the executor marks it read-only
    // in MVP (docs/02 §4.1).
    return { role: 'textbox' };
  }

  return { role: 'generic' };
}

function hasAccessibleLabelHint(element: Element): boolean {
  return (
    (element.getAttribute('aria-label') ?? '').trim() !== '' ||
    (element.getAttribute('aria-labelledby') ?? '').trim() !== ''
  );
}

function selectRole(element: Element): SemanticRole {
  const multiple = element.hasAttribute('multiple');
  const size = Number.parseInt(element.getAttribute('size') ?? '', 10);
  return multiple || size > 1 ? 'listbox' : 'combobox';
}

function headerCellRole(element: Element): SemanticRole {
  const scope = (element.getAttribute('scope') ?? '').toLowerCase();
  if (scope === 'row') return 'rowheader';
  if (scope === 'col' || scope === 'colgroup') return 'columnheader';
  // Determinable heuristic: a th in the first row of a table is a column
  // header; otherwise a row header (docs/02 §6 "when determinable").
  const row = element.closest('tr');
  const table = element.closest('table');
  if (row && table) {
    const rows = table.querySelectorAll('tr');
    if (rows.length > 0 && rows[0] === row) return 'columnheader';
  }
  return 'rowheader';
}
