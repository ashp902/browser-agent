// press_key (docs/03 §12).
//
// Fixed allowlist of keys, no modifiers. Synthetic keyboard events are not
// trusted and cannot reproduce every browser default behavior; we dispatch a
// deterministic keydown/keyup pair on the focused target and fail clearly
// rather than emulating arbitrary browser internals.

import type { ActionResult, BrowserActionRequest } from '../../shared/action-protocol';
import type { ExecutionContext, TargetContext } from './executor';
import { failure, focusIfFocusable, requireVisible, resolveTarget, scrollIntoViewIfNeeded, success } from './executor';

interface KeySpec {
  key: string;
  code: string;
  keyCode: number;
}

const ALLOWED_KEYS: Record<string, KeySpec> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  Space: { key: ' ', code: 'Space', keyCode: 32 },
};

export function dispatchKeySpec(element: Element, spec: KeySpec): void {
  const view = element.ownerDocument?.defaultView;
  if (!view) return;
  for (const type of ['keydown', 'keyup'] as const) {
    const event = new view.KeyboardEvent(type, {
      key: spec.key,
      code: spec.code,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    // Legacy keyCode/which are not settable via KeyboardEventInit.
    Object.defineProperty(event, 'keyCode', { value: spec.keyCode });
    Object.defineProperty(event, 'which', { value: spec.keyCode });
    element.dispatchEvent(event);
  }
}

export function runPressKey(
  request: BrowserActionRequest,
  ctx: ExecutionContext,
  _target: TargetContext | null,
): ActionResult {
  const key = request.args['key'];
  if (typeof key !== 'string') {
    return failure(request, ctx, 'INVALID_ARGUMENT', 'press_key requires a "key" argument.');
  }
  const spec = ALLOWED_KEYS[key];
  if (!spec) {
    return failure(
      request,
      ctx,
      'INVALID_ARGUMENT',
      'Unsupported key. Allowed keys: Enter, Escape, Tab, Arrow keys, Home, End, PageUp, PageDown, Space.',
    );
  }

  let eventTarget: Element;
  if (request.args['element_id'] !== undefined) {
    // Revalidate through the standard pipeline when a target is given.
    const resolved = resolveTarget(request, ctx);
    if (!resolved.ok) return resolved.result;
    const invisible = requireVisible(request, ctx, resolved.target.element);
    if (invisible) return invisible;
    eventTarget = resolved.target.element;
    scrollIntoViewIfNeeded(eventTarget);
    focusIfFocusable(eventTarget);
  } else {
    const active = ctx.doc.activeElement ?? ctx.doc.body;
    if (!active) {
      return failure(request, ctx, 'ACTION_FAILED', 'No element is available to receive the key.', true);
    }
    eventTarget = active;
  }

  dispatchKeySpec(eventTarget, spec);

  const describedAs =
    request.args['element_id'] !== undefined
      ? `key ${spec.key} on element ${String(request.args['element_id'])}`
      : `key ${spec.key}`;
  return success(request, ctx, `Pressed ${describedAs}.`, { changed: true });
}
