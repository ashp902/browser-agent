// set_checked (docs/03 §11).
//
// Checkboxes can be set true/false; radios only true (deselecting a radio
// happens by choosing another radio, so false is UNSUPPORTED_TARGET). When the
// state already matches, no click occurs and changed=false is returned.

import type { ActionResult, BrowserActionRequest } from '../../shared/action-protocol';
import type { ExecutionContext, TargetContext } from './executor';
import { failure, focusIfFocusable, requireVisible, scrollIntoViewIfNeeded, stillConnected, success } from './executor';

function currentCheckedState(element: Element): boolean | 'mixed' | undefined {
  if (element.tagName === 'INPUT') {
    const type = (element.getAttribute('type') ?? '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      return (element as HTMLInputElement).checked;
    }
  }
  const aria = element.getAttribute('aria-checked');
  if (aria === 'true') return true;
  if (aria === 'false') return false;
  if (aria === 'mixed') return 'mixed';
  return undefined;
}

export function runSetChecked(
  request: BrowserActionRequest,
  ctx: ExecutionContext,
  target: TargetContext | null,
): ActionResult {
  if (!target) {
    return failure(request, ctx, 'INVALID_ARGUMENT', 'set_checked requires an element target.');
  }
  const { element, role } = target;

  const checked = request.args['checked'];
  if (typeof checked !== 'boolean') {
    return failure(request, ctx, 'INVALID_ARGUMENT', 'set_checked requires boolean "checked".');
  }

  const isNativeCheckable =
    element.tagName === 'INPUT' &&
    ['checkbox', 'radio'].includes((element.getAttribute('type') ?? '').toLowerCase());
  const isAriaCheckable =
    role === 'checkbox' || role === 'radio' || role === 'switch' ||
    element.getAttribute('role') === 'checkbox' || element.getAttribute('role') === 'radio' ||
    element.getAttribute('role') === 'switch';
  if (!isNativeCheckable && !isAriaCheckable) {
    return failure(
      request,
      ctx,
      'UNSUPPORTED_TARGET',
      'Only checkbox, radio, and switch targets support set_checked.',
    );
  }

  const isRadio =
    (element.tagName === 'INPUT' && (element.getAttribute('type') ?? '').toLowerCase() === 'radio') ||
    role === 'radio' ||
    element.getAttribute('role') === 'radio';
  if (isRadio && checked === false) {
    return failure(
      request,
      ctx,
      'UNSUPPORTED_TARGET',
      'Radios cannot be unchecked directly; choose another radio instead.',
    );
  }

  if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') {
    return failure(request, ctx, 'TARGET_DISABLED', 'The target is disabled.');
  }

  const invisible = requireVisible(request, ctx, element);
  if (invisible) return invisible;

  const before = currentCheckedState(element);
  if (before === checked) {
    const name = target.name || element.tagName.toLowerCase();
    return success(request, ctx, `"${name}" was already ${checked ? 'checked' : 'unchecked'}.`, {
      changed: false,
    });
  }

  scrollIntoViewIfNeeded(element);
  focusIfFocusable(element);

  const notConnected = stillConnected(request, ctx, element);
  if (notConnected) return notConnected;

  // .click() preserves page event behavior (docs/03 §11).
  (element as HTMLElement).click();

  const after = currentCheckedState(element);
  if (after !== checked) {
    return failure(request, ctx, 'ACTION_FAILED', 'The checked state did not change as requested.', true);
  }

  const summaryName = target.name || element.tagName.toLowerCase();
  return success(request, ctx, `${checked ? 'Checked' : 'Unchecked'} "${summaryName}".`, {
    changed: true,
  });
}
