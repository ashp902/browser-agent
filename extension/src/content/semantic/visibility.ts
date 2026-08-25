// Visibility filter (docs/02 §5).
//
// Semantic extraction covers currently rendered/available page content.
// Viewport intersection is intentionally NOT used: off-screen scrollable
// content is still semantically present.
//
// Style inspection always goes through element.ownerDocument.defaultView so
// behavior is identical in Chrome and in multi-window test environments.

export interface VisibilityContext {
  /**
   * Whether the environment provides rendered layout. jsdom and similar test
   * environments report no client rects at all; when layout is unavailable the
   * rect-based check is skipped (otherwise every element would look hidden).
   */
  layoutAvailable: boolean;
}

function viewOf(element: Element): Window | null {
  return element.ownerDocument?.defaultView ?? null;
}

export function detectLayoutAvailability(doc: Document): boolean {
  if (!doc.documentElement) return false;
  // Layout-capable engines always render the root element; jsdom-style
  // environments report zero rects everywhere.
  const rootRects = doc.documentElement.getClientRects().length;
  const bodyRects = doc.body ? doc.body.getClientRects().length : 0;
  return rootRects > 0 || bodyRects > 0;
}

export function createVisibilityContext(doc: Document): VisibilityContext {
  return { layoutAvailable: detectLayoutAvailability(doc) };
}

/**
 * True when the element is semantically hidden per docs/02 §5: hidden
 * attribute, aria-hidden on self/ancestor, computed display/visibility
 * suppression, closed <details> subtree (outside summary), closed <dialog>,
 * or (when layout exists) no rendered client rect.
 */
export function isSemanticallyHidden(element: Element, context: VisibilityContext): boolean {
  const view = viewOf(element);

  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute('hidden')) return true;
    if (current.getAttribute('aria-hidden') === 'true') return true;

    if (view) {
      const style = view.getComputedStyle(current);
      if (style.display === 'none') return true;
      if (style.visibility === 'hidden' || style.visibility === 'collapse') return true;
    }

    // Inside a closed <details> subtree other than its summary.
    if (current.tagName === 'DETAILS' && (current as HTMLDetailsElement).open !== true) {
      if (!isWithinSummaryOf(element, current)) return true;
    }

    // A closed <dialog> is not rendered (docs/02 §5 "no rendered client rect").
    if (current.tagName === 'DIALOG' && (current as HTMLDialogElement).open !== true) {
      return true;
    }

    current = current.parentElement;
  }

  if (context.layoutAvailable) {
    // Ordinary visual elements with no rendered rect are treated as hidden.
    if (element.getClientRects().length === 0) return true;
  }

  return false;
}

function isWithinSummaryOf(element: Element, details: Element): boolean {
  const summary = Array.from(details.children).find((child) => child.tagName === 'SUMMARY');
  if (!summary) return false;
  return summary === element || summary.contains(element);
}
