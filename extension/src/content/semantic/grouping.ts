// Repeated-container inference (docs/02 §11).
//
// Conservative heuristic: a generic DOM element becomes an inferred `group`
// only when sibling-structure evidence shows a repeated pattern and the
// candidate carries identifying content alongside an actionable control. We
// never invent domain types (no `product`, `order`, ...) - inference emits
// `group` with inferred_group=true and lets the LLM read the content.

import { deriveRole } from './roles';
import type { VisibilityContext } from './visibility';
import { isSemanticallyHidden } from './visibility';
import type { SemanticRole } from './types';

export const ACTIONABLE_ROLES: ReadonlySet<SemanticRole> = new Set([
  'link',
  'button',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'switch',
  'combobox',
  'listbox',
  'slider',
  'spinbutton',
  'tab',
  'menuitem',
]);

export function isActionableRole(role: SemanticRole): boolean {
  return ACTIONABLE_ROLES.has(role);
}

export interface ElementMetrics {
  /** Visible actionable elements in the subtree, including self. */
  actionableCount: number;
  /** Heading, labeled image, or descriptive text present outside controls. */
  hasIdentifyingContent: boolean;
  /** Primary structural identity (docs/02 §11.1): tag, explicit role, first
   * two CSS class tokens. Class tokens are local heuristic input only and are
   * never emitted in model-facing output. */
  primarySignature: string;
  /** Role types of shallow interactive descendants up to depth 3. */
  interactiveRoles: string[];
}

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

function directTextOf(element: Element): string {
  let text = '';
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += ` ${node.textContent ?? ''}`;
    }
  }
  return text.replace(/\s+/g, ' ').trim();
}

function primarySignature(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const role = (element.getAttribute('role') ?? '').trim().split(/\s+/)[0] ?? '';
  const classTokens = (element.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return [tag, role, classTokens.join('.')].join('|');
}

function interactiveRoleProfile(element: Element, maxDepth: number): string[] {
  const roles = new Set<string>();
  const visit = (current: Element, depth: number) => {
    if (depth > maxDepth) return;
    const { role } = deriveRole(current);
    if (isActionableRole(role)) {
      roles.add(role);
    }
    for (const child of Array.from(current.children)) {
      visit(child, depth + 1);
    }
  };
  for (const child of Array.from(element.children)) {
    visit(child, 1);
  }
  return Array.from(roles).sort();
}

/**
 * Similarity is heuristic only (docs/02 §11.1). Siblings match when their
 * primary signatures agree and either carry class tokens or share at least one
 * interactive role type - so a product card with an extra size select still
 * matches its siblings.
 */
export function areStructurallySimilar(a: ElementMetrics, b: ElementMetrics): boolean {
  if (a.primarySignature !== b.primarySignature) return false;
  const classBearing = a.primarySignature.split('|')[2].length > 0;
  if (classBearing) return true;
  return a.interactiveRoles.some((role) => b.interactiveRoles.includes(role));
}

/** Bottom-up per-element metrics used by repeated-group inference. */
export function computeMetrics(root: Element, visibility: VisibilityContext): Map<Element, ElementMetrics> {
  const metrics = new Map<Element, ElementMetrics>();

  const visit = (element: Element): ElementMetrics => {
    if (isSemanticallyHidden(element, visibility)) {
      const empty: ElementMetrics = {
        actionableCount: 0,
        hasIdentifyingContent: false,
        primarySignature: primarySignature(element),
        interactiveRoles: [],
      };
      metrics.set(element, empty);
      return empty;
    }

    // Identifying content must be evidence IN ADDITION to the action
    // (docs/02 §11 condition 5): text consumed as a control's own label never
    // qualifies, so actionable subtrees do not propagate it upward.
    const role = deriveRole(element).role;
    const selfActionable = isActionableRole(role);
    let actionableCount = selfActionable ? 1 : 0;
    let hasIdentifyingContent = false;
    if (!selfActionable) {
      hasIdentifyingContent =
        HEADING_TAGS.has(element.tagName) ||
        directTextOf(element).length > 0 ||
        (element.tagName === 'IMG' &&
          ((element.getAttribute('alt') ?? '').trim().length > 0 ||
            (element.getAttribute('aria-label') ?? '').trim().length > 0));
    }

    for (const child of Array.from(element.children)) {
      const childMetrics = visit(child);
      actionableCount += childMetrics.actionableCount;
      if (!isActionableRole(deriveRole(child).role)) {
        hasIdentifyingContent = hasIdentifyingContent || childMetrics.hasIdentifyingContent;
      }
    }

    const own: ElementMetrics = {
      actionableCount,
      hasIdentifyingContent,
      primarySignature: primarySignature(element),
      interactiveRoles: interactiveRoleProfile(element, 3),
    };
    metrics.set(element, own);
    return own;
  };

  visit(root);
  return metrics;
}

/**
 * True when the element qualifies as an inferred repeated group
 * (docs/02 §11 conditions 1-5). The caller has already established the element
 * has no stronger semantic role.
 */
export function qualifiesAsInferredGroup(
  element: Element,
  metrics: Map<Element, ElementMetrics>,
): boolean {
  const own = metrics.get(element);
  if (!own || own.actionableCount < 1 || !own.hasIdentifyingContent) {
    return false;
  }

  const parent = element.parentElement;
  if (!parent) return false;

  const similarSiblings = Array.from(parent.children).filter((sibling) => {
    const siblingMetrics = metrics.get(sibling);
    return siblingMetrics !== undefined && areStructurallySimilar(own, siblingMetrics);
  });
  if (similarSiblings.length < 2) return false;

  const siblingsWithActions = similarSiblings.filter(
    (sibling) => (metrics.get(sibling)?.actionableCount ?? 0) >= 1,
  );
  return siblingsWithActions.length >= 2;
}
