// scroll_page / scroll_element (docs/03 §13-§14).
//
// Deterministic viewport-relative amounts. Page scrolling uses the scrolling
// element so behavior matches across standards-mode documents.

import type { ActionResult, BrowserActionRequest } from '../../shared/action-protocol';
import type { ExecutionContext, TargetContext } from './executor';
import { failure, requireVisible, resolveTarget, success } from './executor';

type Direction = 'up' | 'down' | 'top' | 'bottom';
const AMOUNT_FACTORS: Record<string, number> = { small: 0.35, medium: 0.75, large: 1.25 };

/** docs/03 §13 deterministic amounts as fractions of viewport height. */
export function computeScrollByPixels(
  direction: Exclude<Direction, 'top' | 'bottom'>,
  amount: string | undefined,
  viewportHeight: number,
): number {
  const factor = AMOUNT_FACTORS[amount ?? 'medium'] ?? AMOUNT_FACTORS.medium;
  const magnitude = Math.round(factor * Math.max(0, viewportHeight));
  return direction === 'up' ? -magnitude : magnitude;
}

interface ScrollArgs {
  direction: Direction;
  amount: string | undefined;
}

function parseScrollArgs(request: BrowserActionRequest, ctx: ExecutionContext): {
  ok: true;
  args: ScrollArgs;
} | { ok: false; result: ActionResult } {
  const direction = request.args['direction'];
  if (direction !== 'up' && direction !== 'down' && direction !== 'top' && direction !== 'bottom') {
    return {
      ok: false,
      result: failure(request, ctx, 'INVALID_ARGUMENT', 'direction must be up, down, top, or bottom.'),
    };
  }
  const amount = request.args['amount'];
  if (amount !== undefined && amount !== 'small' && amount !== 'medium' && amount !== 'large') {
    return {
      ok: false,
      result: failure(request, ctx, 'INVALID_ARGUMENT', 'amount must be small, medium, or large.'),
    };
  }
  return { ok: true, args: { direction, amount } };
}

export function runScrollPage(request: BrowserActionRequest, ctx: ExecutionContext): ActionResult {
  const parsed = parseScrollArgs(request, ctx);
  if (!parsed.ok) return parsed.result;
  const { direction, amount } = parsed.args;

  const view = ctx.doc.defaultView;
  const scroller = (ctx.doc.scrollingElement ?? ctx.doc.documentElement) as HTMLElement | null;
  if (!view || !scroller) {
    return failure(request, ctx, 'ACTION_FAILED', 'The page cannot be scrolled.', true);
  }

  const before = scroller.scrollTop;
  if (direction === 'top') {
    scroller.scrollTop = 0;
  } else if (direction === 'bottom') {
    scroller.scrollTop = scroller.scrollHeight;
  } else {
    scroller.scrollTop += computeScrollByPixels(direction, amount, view.innerHeight ?? 0);
  }
  const after = scroller.scrollTop;

  return success(request, ctx, `Scrolled page ${direction}.`, {
    data: { scroll_before: before, scroll_after: after },
  });
}

export function runScrollElement(
  request: BrowserActionRequest,
  ctx: ExecutionContext,
  target: TargetContext | null,
): ActionResult {
  if (!target) {
    return failure(request, ctx, 'INVALID_ARGUMENT', 'scroll_element requires an element target.');
  }

  // Revalidate through the standard pipeline (docs/03 §14 mirrors §6).
  const resolved = resolveTarget(request, ctx);
  if (!resolved.ok) return resolved.result;

  const invisible = requireVisible(request, ctx, resolved.target.element);
  if (invisible) return invisible;

  const parsed = parseScrollArgs(request, ctx);
  if (!parsed.ok) return parsed.result;
  const { direction, amount } = parsed.args;

  const element = resolved.target.element as HTMLElement;
  const range = element.scrollHeight - element.clientHeight;
  if (!(range > 0)) {
    return failure(
      request,
      ctx,
      'UNSUPPORTED_TARGET',
      'The target does not have a scrollable overflow region.',
    );
  }

  const before = element.scrollTop;
  const view = ctx.doc.defaultView;
  if (direction === 'top') {
    element.scrollTop = 0;
  } else if (direction === 'bottom') {
    element.scrollTop = element.scrollHeight;
  } else {
    element.scrollTop += computeScrollByPixels(direction, amount, view?.innerHeight ?? 0);
  }
  const after = element.scrollTop;

  const summaryName = resolved.target.name || element.tagName.toLowerCase();
  return success(request, ctx, `Scrolled "${summaryName}" ${direction}.`, {
    data: { scroll_before: before, scroll_after: after },
  });
}
