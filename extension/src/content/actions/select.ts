// select_option (docs/03 §10).
//
// Native <select> only; exactly one of option_value / option_label. Label
// matching requires a single unambiguous normalized match.

import type { ActionResult, BrowserActionRequest } from '../../shared/action-protocol';
import { normalizeText } from '../semantic/accessible-name';
import type { ExecutionContext, TargetContext } from './executor';
import { failure, focusIfFocusable, requireVisible, scrollIntoViewIfNeeded, stillConnected, success } from './executor';

export function runSelectOption(
  request: BrowserActionRequest,
  ctx: ExecutionContext,
  target: TargetContext | null,
): ActionResult {
  if (!target) {
    return failure(request, ctx, 'INVALID_ARGUMENT', 'select_option requires an element target.');
  }
  const { element } = target;

  const optionValue = request.args['option_value'];
  const optionLabel = request.args['option_label'];
  const byValue = typeof optionValue === 'string';
  const byLabel = typeof optionLabel === 'string';
  if (byValue === byLabel) {
    return failure(
      request,
      ctx,
      'INVALID_ARGUMENT',
      'Provide exactly one of option_value or option_label.',
    );
  }

  if (element.tagName !== 'SELECT') {
    return failure(
      request,
      ctx,
      'UNSUPPORTED_TARGET',
      'Only native <select> elements are supported in MVP; custom comboboxes are driven with click/keyboard actions.',
    );
  }
  const select = element as HTMLSelectElement;

  if (element.hasAttribute('disabled') || select.disabled) {
    return failure(request, ctx, 'TARGET_DISABLED', 'The target is disabled.');
  }

  const invisible = requireVisible(request, ctx, element);
  if (invisible) return invisible;

  // Step 1-2: find the matching enabled option.
  let matched: HTMLOptionElement | undefined;
  if (byValue) {
    for (const option of Array.from(select.options)) {
      if (option.value === optionValue && !option.disabled) {
        matched = option;
        break;
      }
    }
  } else {
    const wanted = normalizeText(optionLabel as string).toLowerCase();
    let ambiguous = false;
    for (const option of Array.from(select.options)) {
      if (option.disabled) continue;
      if (normalizeText(option.textContent ?? '').toLowerCase() === wanted) {
        if (matched === undefined) {
          matched = option;
        } else {
          ambiguous = true;
          break;
        }
      }
    }
    if (ambiguous) {
      return failure(
        request,
        ctx,
        'INVALID_ARGUMENT',
        'The requested label matches multiple options.',
      );
    }
  }

  if (!matched) {
    return failure(
      request,
      ctx,
      'INVALID_ARGUMENT',
      'No enabled option matched the requested value or label.',
    );
  }

  scrollIntoViewIfNeeded(element);
  focusIfFocusable(element);

  const notConnected = stillConnected(request, ctx, element);
  if (notConnected) return notConnected;

  const previous = select.value;
  // Steps 3-4: update native selection and dispatch framework-visible events.
  select.value = matched.value;
  select.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));

  // Step 5: verify.
  if (select.value !== matched.value || select.selectedOptions[0] !== matched) {
    return failure(request, ctx, 'ACTION_FAILED', 'The selection did not change as requested.', true);
  }

  const summaryName = target.name || 'select';
  const label = normalizeText(matched.textContent ?? '') || matched.value;
  return success(request, ctx, `Selected "${label}" in "${summaryName}".`, {
    changed: previous !== matched.value,
    data: { value: matched.value, label },
  });
}
