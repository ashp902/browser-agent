// navigate_current_tab / go_back (docs/03 §15-§16).
//
// Only http:/https: navigation; relative URLs resolve against the current
// document before any policy consideration. Navigation is deferred one tick so
// the structured result reaches the caller before the document unloads.

import type { ActionResult, BrowserActionRequest } from '../../shared/action-protocol';
import type { ExecutionContext } from './executor';
import { failure, success } from './executor';

/**
 * Resolves and validates an in-tab navigation URL (docs/03 §15). Returns null
 * for forbidden schemes or unparseable input.
 */
export function resolveNavigationUrl(currentUrl: string, rawInput: unknown): string | null {
  if (typeof rawInput !== 'string' || rawInput.trim() === '') return null;
  let resolved: URL;
  try {
    resolved = new URL(rawInput, currentUrl);
  } catch {
    return null;
  }
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    return null;
  }
  return resolved.href;
}

export function runNavigateCurrentTab(
  request: BrowserActionRequest,
  ctx: ExecutionContext,
): ActionResult {
  const href = resolveNavigationUrl(ctx.doc.URL, request.args['url']);
  if (!href) {
    // Forbidden schemes are never retried (docs/04 §14).
    return failure(
      request,
      ctx,
      'NAVIGATION_BLOCKED',
      'Only ordinary http/https URLs can be navigated to.',
      false,
    );
  }

  const view = ctx.doc.defaultView;
  if (!view) {
    return failure(request, ctx, 'ACTION_FAILED', 'No window is available for navigation.');
  }

  const sameOrigin = new URL(href).origin === new URL(ctx.doc.URL).origin;
  const result = success(request, ctx, `Navigating to ${href}.`, {
    changed: true,
    data: { url: href, same_origin: sameOrigin },
  });
  // The response must escape before the document starts unloading.
  setTimeout(() => {
    try {
      view.location.assign(href);
    } catch {
      // Navigation failures surface through the next observation instead.
    }
  }, 0);
  return result;
}

export function runGoBack(request: BrowserActionRequest, ctx: ExecutionContext): ActionResult {
  const view = ctx.doc.defaultView;
  if (!view) {
    return failure(request, ctx, 'ACTION_FAILED', 'No window is available for history back.');
  }

  const hasBackEntry = view.history.length > 1;
  if (!hasBackEntry) {
    // Normal no-op result when no history entry exists (docs/03 §16).
    return success(request, ctx, 'No previous page in this tab.', { changed: false });
  }

  const result = success(request, ctx, 'Going back to the previous page.', { changed: true });
  setTimeout(() => {
    try {
      view.history.back();
    } catch {
      // History failures surface through the next observation instead.
    }
  }, 0);
  return result;
}
