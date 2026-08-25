// click_element (docs/03 §8).
//
// Native .click() only; MVP never synthesizes low-level trusted pointer
// events. Sites that reject programmatic clicks are a documented ACTION_FAILED
// limitation, not a reason to add privileged injection.

import type { ActionResult, BrowserActionRequest } from '../../shared/action-protocol';
import type { ExecutionContext, TargetContext } from './executor';
import { failure, focusIfFocusable, requireVisible, scrollIntoViewIfNeeded, stillConnected, success } from './executor';
import { isActionableRole } from '../semantic/grouping';

const NATIVE_CLICKABLE_TAGS = new Set(['BUTTON', 'A', 'SUMMARY']);

const CLICKABLE_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image', 'checkbox', 'radio']);

export function runClick(
  request: BrowserActionRequest,
  ctx: ExecutionContext,
  target: TargetContext | null,
): ActionResult {
  if (!target) {
    return failure(request, ctx, 'INVALID_ARGUMENT', 'click_element requires an element target.');
  }
  const { element, role } = target;

  // Step 6: action support.
  const inputType =
    element.tagName === 'INPUT' ? (element.getAttribute('type') ?? 'text').toLowerCase() : undefined;
  const clickable =
    isActionableRole(role) ||
    NATIVE_CLICKABLE_TAGS.has(element.tagName) ||
    (element.tagName === 'INPUT' && inputType !== undefined && CLICKABLE_INPUT_TYPES.has(inputType));
  if (!clickable) {
    return failure(
      request,
      ctx,
      'UNSUPPORTED_TARGET',
      `This target does not support clicking (${element.tagName.toLowerCase()}).`,
    );
  }

  // Step 7: disabled state.
  if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') {
    return failure(request, ctx, 'TARGET_DISABLED', 'The target is disabled.');
  }

  const invisible = requireVisible(request, ctx, element);
  if (invisible) return invisible;

  scrollIntoViewIfNeeded(element);

  // Focus when focusable; focusing is non-destructive here because no text
  // selection state is involved.
  focusIfFocusable(element);

  const notConnected = stillConnected(request, ctx, element);
  if (notConnected) return notConnected;

  const summaryName = target.name || element.tagName.toLowerCase();
  (element as HTMLElement).click();
  return success(request, ctx, `Clicked ${role === 'generic' ? element.tagName.toLowerCase() : role} "${summaryName}".`);
}
