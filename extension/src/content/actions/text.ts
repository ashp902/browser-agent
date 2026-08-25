// set_text (docs/03 §9).
//
// Replace-mode only. Uses the native prototype value setter so framework
// wrappers (React et al.) observe the update, then dispatches bubbling
// composed `input` followed by `change`. Passwords, OTP/card fields,
// contenteditable, rich editors, and file inputs are refused for manual entry.

import type { ActionResult, BrowserActionRequest } from '../../shared/action-protocol';
import { classifyFieldSensitivity } from '../semantic/sensitivity';
import type { ExecutionContext, TargetContext } from './executor';
import { failure, focusIfFocusable, requireVisible, scrollIntoViewIfNeeded, stillConnected, success } from './executor';

const SETTABLE_TEXT_INPUT_TYPES = new Set([
  'text',
  'email',
  'tel',
  'url',
  'search',
  'number',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
  'range',
]);

export function runSetText(
  request: BrowserActionRequest,
  ctx: ExecutionContext,
  target: TargetContext | null,
): ActionResult {
  if (!target) {
    return failure(request, ctx, 'INVALID_ARGUMENT', 'set_text requires an element target.');
  }
  const { element } = target;

  const text = request.args['text'];
  if (typeof text !== 'string') {
    return failure(request, ctx, 'INVALID_ARGUMENT', 'set_text requires a string "text" argument.');
  }
  const mode = request.args['mode'] ?? 'replace';
  if (mode !== 'replace') {
    return failure(request, ctx, 'INVALID_ARGUMENT', 'Only mode="replace" exists in MVP.');
  }

  const isTextInput =
    (element.tagName === 'INPUT' &&
      SETTABLE_TEXT_INPUT_TYPES.has((element.getAttribute('type') ?? 'text').toLowerCase())) ||
    element.tagName === 'TEXTAREA';
  if (!isTextInput) {
    return failure(
      request,
      ctx,
      'UNSUPPORTED_TARGET',
      'Text entry is only supported for ordinary text inputs and textareas in MVP.',
    );
  }

  // Sensitive-manual classification is refused regardless of shape
  // (docs/06 §5.2): passwords/OTP/card data are entered by the user directly.
  if (classifyFieldSensitivity(element) === 'secret') {
    return failure(
      request,
      ctx,
      'UNSUPPORTED_TARGET',
      'This field must be filled in manually by the user.',
    );
  }

  if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') {
    return failure(request, ctx, 'TARGET_DISABLED', 'The target is disabled.');
  }
  if (element.hasAttribute('readonly') || element.getAttribute('aria-readonly') === 'true') {
    return failure(request, ctx, 'TARGET_DISABLED', 'The target is read-only.');
  }

  const invisible = requireVisible(request, ctx, element);
  if (invisible) return invisible;

  scrollIntoViewIfNeeded(element);
  focusIfFocusable(element);

  const notConnected = stillConnected(request, ctx, element);
  if (notConnected) return notConnected;

  setValueWithNativeSetter(element as HTMLInputElement | HTMLTextAreaElement, text);

  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));

  const resultingValue = (element as HTMLInputElement).value;
  if (resultingValue !== text) {
    return failure(request, ctx, 'ACTION_FAILED', 'The field did not accept the requested value.', true);
  }

  const summaryName = target.name || element.tagName.toLowerCase();
  return success(request, ctx, `Entered text into "${summaryName}".`, {
    changed: true,
    data: { value_length: text.length },
  });
}

/**
 * Writes through the prototype's native value descriptor (docs/03 §9 step 5)
 * instead of assigning the instance property directly, which framework value
 * trackers would miss.
 */
function setValueWithNativeSetter(element: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
  if (descriptor?.set) {
    descriptor.set.call(element, text);
  } else {
    element.value = text;
  }
}
