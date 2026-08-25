// Accessible name extraction (docs/02 §7).
//
// Deterministic practical subset of accname-1.2. We do not invent labels from
// unrelated prose; grouping supplies context separately.

import { MAX_NODE_DESCRIPTION_CHARS, MAX_NODE_NAME_CHARS, type SemanticRole } from './types';

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  // Account for the ellipsis marker inside the budget.
  return { text: `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`, truncated: true };
}

export interface NameResult {
  name: string;
  truncated: boolean;
}

const TEXT_NAMED_ROLES: ReadonlySet<SemanticRole> = new Set(['button', 'link', 'menuitem', 'tab']);

const TEXT_ENTRY_ROLES: ReadonlySet<SemanticRole> = new Set(['textbox', 'searchbox', 'spinbutton', 'combobox']);

/** Visible rendered text of an element's own subtree, normalized. */
function ownTextContent(element: Element): string {
  return normalizeText(element.textContent ?? '');
}

function textByIds(element: Element, attribute: string): string {
  const ids = (element.getAttribute(attribute) ?? '').trim().split(/\s+/).filter(Boolean);
  if (ids.length === 0) return '';
  const doc = element.ownerDocument;
  const parts: string[] = [];
  for (const id of ids) {
    const target = doc.getElementById(id);
    if (target) {
      const text = ownTextContent(target);
      if (text) parts.push(text);
    }
  }
  return normalizeText(parts.join(' '));
}

/** <label for> association plus wrapping-label lookup for form controls. */
function labelText(element: Element): string {
  const doc = element.ownerDocument;
  const parts: string[] = [];

  const id = element.getAttribute('id');
  if (id) {
    // Iterating labels avoids selector-escaping pitfalls entirely.
    for (const label of Array.from(doc.querySelectorAll('label'))) {
      if (label.getAttribute('for') === id) {
        const text = ownTextContent(label);
        if (text) parts.push(text);
      }
    }
  }

  const wrapping = element.closest('label');
  if (wrapping) {
    // Exclude the control's own text from the wrapping label's text.
    const clone = normalizeText(
      Array.from(wrapping.childNodes)
        .filter((node) => node !== element && !node.contains(element))
        .map((node) => node.textContent ?? '')
        .join(' '),
    );
    if (clone) parts.push(clone);
  }

  return normalizeText(parts.join(' '));
}

function fieldsetLegendText(element: Element): string {
  const legend = Array.from(element.children).find((child) => child.tagName === 'LEGEND');
  return legend ? ownTextContent(legend) : '';
}

/**
 * Computes the accessible name per docs/02 §7 precedence. Returns an empty
 * string when no name exists; callers decide whether the node stays nameless.
 */
export function computeAccessibleName(element: Element, role: SemanticRole): NameResult {
  let raw = '';

  // 1. aria-labelledby references in order.
  raw = textByIds(element, 'aria-labelledby');

  // 2. aria-label.
  if (!raw) {
    raw = normalizeText(element.getAttribute('aria-label') ?? '');
  }

  // 3. Associated <label> for form controls.
  if (!raw && isLabelable(element)) {
    raw = labelText(element);
  }

  // Fieldset legend is its naming mechanism (group role from FIELDSET).
  if (!raw && element.tagName === 'FIELDSET') {
    raw = fieldsetLegendText(element);
  }

  // 4. Native naming attributes.
  if (!raw) {
    if (element.tagName === 'IMG') {
      raw = normalizeText(element.getAttribute('alt') ?? '');
    } else if (element.tagName === 'INPUT') {
      const type = (element.getAttribute('type') ?? 'text').toLowerCase();
      if (type === 'image') {
        raw = normalizeText(element.getAttribute('alt') ?? '');
      } else if (type === 'submit' || type === 'reset' || type === 'button') {
        raw = normalizeText((element as HTMLInputElement).value ?? '');
      }
    } else if (element.tagName === 'FORM') {
      raw = normalizeText(element.getAttribute('name') ?? '');
    }
  }

  // 5. Concise rendered text for button/link-like roles; headings are also
  // named by their content.
  if (!raw && (TEXT_NAMED_ROLES.has(role) || role === 'heading')) {
    raw = ownTextContent(element);
  }

  // 6. Placeholder fallback for text-entry controls.
  if (!raw && TEXT_ENTRY_ROLES.has(role)) {
    raw = normalizeText(element.getAttribute('placeholder') ?? '');
  }

  // 7. title as final fallback.
  if (!raw) {
    raw = normalizeText(element.getAttribute('title') ?? '');
  }

  const { text, truncated } = truncate(raw, MAX_NODE_NAME_CHARS);
  return { name: text, truncated };
}

/** aria-describedby / aria-description, kept separate from name (docs/02 §7). */
export function computeDescription(element: Element): { description: string; truncated: boolean } {
  const ariaDescription = normalizeText(element.getAttribute('aria-description') ?? '');
  const raw = ariaDescription || textByIds(element, 'aria-describedby');
  const result = truncate(raw, MAX_NODE_DESCRIPTION_CHARS);
  return { description: result.text, truncated: result.truncated };
}

function isLabelable(element: Element): boolean {
  const tag = element.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'METER' || tag === 'PROGRESS') return true;
  if (tag === 'INPUT') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    return type !== 'hidden';
  }
  return false;
}
