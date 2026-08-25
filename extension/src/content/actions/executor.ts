// Deterministic action executor core (docs/03).
//
// Every action passes the same validation sequence before touching the page:
// document identity, element resolution, connection, fingerprint revalidation,
// action support, disabled/read-only state, semantic visibility. Epoch
// mismatch never rejects by itself (ADR-018) - it only demands that the
// fingerprint still match.

import type { ActionErrorCode, ActionResult, BrowserActionRequest, BrowserToolName } from '../../shared/action-protocol';
import { computeAccessibleName } from '../semantic/accessible-name';
import { computeSemanticFingerprint } from '../semantic/extractor';
import { deriveRole } from '../semantic/roles';
import { createVisibilityContext, isSemanticallyHidden } from '../semantic/visibility';
import type { MutationTracker } from '../registry/mutation-tracker';
import type { ElementRegistry } from '../registry/element-registry';
import { runClick } from './click';
import { runSetText } from './text';
import { runSelectOption } from './select';
import { runSetChecked } from './check';
import { runPressKey } from './keyboard';
import { runScrollPage, runScrollElement } from './scroll';
import { runNavigateCurrentTab, runGoBack } from './navigation';

/** Minimum idempotency cache size (docs/03 §17). */
const IDEMPOTENCY_CACHE_SIZE = 128;

export interface TargetContext {
  element: Element;
  role: ReturnType<typeof deriveRole>['role'];
  name: string;
}

export interface ExecutionContext {
  doc: Document;
  documentId: string;
  registry: ElementRegistry;
  tracker: MutationTracker;
  /** Per-document duplicate-action protection (docs/03 §17). */
  idempotency: IdempotencyCache;
}

export class IdempotencyCache {
  private entries = new Map<string, ActionResult>();

  get(actionId: string): ActionResult | undefined {
    const cached = this.entries.get(actionId);
    if (cached !== undefined) {
      // Refresh recency.
      this.entries.delete(actionId);
      this.entries.set(actionId, cached);
    }
    return cached;
  }

  set(actionId: string, result: ActionResult): void {
    if (this.entries.has(actionId)) this.entries.delete(actionId);
    this.entries.set(actionId, result);
    while (this.entries.size > IDEMPOTENCY_CACHE_SIZE) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

export function failure(
  request: BrowserActionRequest,
  ctx: ExecutionContext,
  code: ActionErrorCode,
  message: string,
  retryable?: boolean,
): ActionResult {
  const epoch = ctx.tracker.currentEpoch;
  return {
    protocol_version: 1,
    action_id: request.action_id,
    document_id: ctx.documentId,
    mutation_epoch_before: epoch,
    mutation_epoch_after: epoch,
    ok: false,
    summary: message,
    error: {
      code,
      message,
      ...(retryable === undefined ? {} : { retryable }),
    },
  };
}

export function success(
  request: BrowserActionRequest,
  ctx: ExecutionContext,
  summary: string,
  options?: { changed?: boolean; data?: Record<string, unknown>; epochAfter?: number },
): ActionResult {
  const epochAfter = options?.epochAfter ?? ctx.tracker.currentEpoch;
  return {
    protocol_version: 1,
    action_id: request.action_id,
    document_id: ctx.documentId,
    mutation_epoch_before: ctx.tracker.currentEpoch,
    mutation_epoch_after: epochAfter,
    ok: true,
    summary,
    ...(options?.changed === undefined ? {} : { changed: options.changed }),
    ...(options?.data === undefined ? {} : { data: options.data }),
  };
}

/**
 * Resolves and validates an element target shared by all element tools
 * (docs/03 §6 steps 1-5).
 */
export function resolveTarget(
  request: BrowserActionRequest,
  ctx: ExecutionContext,
): { ok: true; target: TargetContext } | { ok: false; result: ActionResult } {
  // Step 1: document identity gates everything else.
  if (request.document_id !== ctx.documentId) {
    return {
      ok: false,
      result: failure(
        request,
        ctx,
        'DOCUMENT_CHANGED',
        'The action targets a different document. Observe the page again.',
        true,
      ),
    };
  }

  const elementId = request.args['element_id'];
  if (typeof elementId !== 'number' || !Number.isInteger(elementId)) {
    return {
      ok: false,
      result: failure(request, ctx, 'INVALID_ARGUMENT', 'element_id must be an integer.'),
    };
  }

  // Steps 2-3: resolution and liveness.
  const element = ctx.registry.resolve(elementId);
  if (!element || !element.isConnected) {
    return {
      ok: false,
      result: failure(
        request,
        ctx,
        'TARGET_NOT_FOUND',
        `Element ${elementId} no longer exists in this document. Observe the page again.`,
        true,
      ),
    };
  }

  // Steps 4-5: fingerprint revalidation. Epoch mismatch alone never rejects.
  const derived = deriveRole(element);
  const name = computeAccessibleName(element, derived.role).name;
  if (request.expected_target) {
    const current = computeSemanticFingerprint(element, derived.role, name);
    const expected = request.expected_target;
    // Null and undefined both mean "absent" across the wire boundary.
    const stale =
      current.role !== expected.role ||
      current.tag_name !== expected.tag_name ||
      (expected.input_type != null && current.input_type !== expected.input_type) ||
      (expected.href_origin != null && current.href_origin !== expected.href_origin) ||
      (expected.normalized_name.length > 0 &&
        current.normalized_name.length > 0 &&
        current.normalized_name !== expected.normalized_name);
    if (stale) {
      // Diagnostics ride in result.data for logs/traces; the summary stays
      // model-safe per docs/03 §7.
      const failed: ActionResult = {
        ...failure(
          request,
          ctx,
          'STALE_TARGET',
          'The target changed after it was observed. Observe the page again.',
          true,
        ),
        data: { expected, current },
      };
      console.warn('[executor] stale target', JSON.stringify({ expected, current }));
      return { ok: false, result: failed };
    }
  }

  return { ok: true, target: { element, role: derived.role, name } };
}

/** Shared visibility check for interaction targets (docs/03 §6 step 8). */
export function requireVisible(
  request: BrowserActionRequest,
  ctx: ExecutionContext,
  element: Element,
): ActionResult | undefined {
  if (isSemanticallyHidden(element, createVisibilityContext(ctx.doc))) {
    return failure(request, ctx, 'TARGET_NOT_VISIBLE', 'The target is not currently visible.');
  }
  return undefined;
}

/** Re-checks liveness immediately before mutation (docs/03 §6 step 10). */
export function stillConnected(
  request: BrowserActionRequest,
  ctx: ExecutionContext,
  element: Element,
): ActionResult | undefined {
  if (!element.isConnected) {
    return failure(request, ctx, 'TARGET_NOT_FOUND', 'The target left the page during the action.', true);
  }
  return undefined;
}

/**
 * Scrolls the element into view when the engine supports it; jsdom-style test
 * environments without layout simply skip this step.
 */
export function scrollIntoViewIfNeeded(element: Element): void {
  if (typeof (element as HTMLElement).scrollIntoView === 'function') {
    (element as HTMLElement).scrollIntoView({ block: 'center', inline: 'nearest' });
  }
}

export function focusIfFocusable(element: Element): void {
  if (typeof (element as HTMLElement).focus === 'function') {
    (element as HTMLElement).focus();
  }
}

const ELEMENT_TARGETED_TOOLS = new Set<BrowserToolName>([
  'click_element',
  'set_text',
  'select_option',
  'set_checked',
  'scroll_element',
]);

function runTool(
  request: BrowserActionRequest,
  ctx: ExecutionContext,
  target: TargetContext | null,
): ActionResult {
  switch (request.tool) {
    case 'click_element':
      return runClick(request, ctx, target);
    case 'set_text':
      return runSetText(request, ctx, target);
    case 'select_option':
      return runSelectOption(request, ctx, target);
    case 'set_checked':
      return runSetChecked(request, ctx, target);
    case 'press_key':
      return runPressKey(request, ctx, target);
    case 'scroll_page':
      return runScrollPage(request, ctx);
    case 'scroll_element':
      return runScrollElement(request, ctx, target);
    case 'navigate_current_tab':
      return runNavigateCurrentTab(request, ctx);
    case 'go_back':
      return runGoBack(request, ctx);
  }
}

/**
 * Executes one validated action request. Total: every outcome is a structured
 * ActionResult; raw extension internals never leak into messages (docs/10 §9).
 */
export function executeAction(
  request: BrowserActionRequest,
  ctx: ExecutionContext,
): ActionResult {
  if (request.protocol_version !== 1) {
    // Malformed requests are rejected before any cache/DOM interaction.
    return failure(request, ctx, 'INVALID_ARGUMENT', 'Malformed action request.');
  }

  const cached = ctx.idempotency.get(request.action_id);
  if (cached) return cached;

  let result: ActionResult;
  try {
    let target: TargetContext | null = null;
    if (ELEMENT_TARGETED_TOOLS.has(request.tool)) {
      const resolved = resolveTarget(request, ctx);
      if (!resolved.ok) {
        result = resolved.result;
        ctx.idempotency.set(request.action_id, result);
        return result;
      }
      target = resolved.target;
    }
    result = runTool(request, ctx, target);
  } catch {
    result = failure(request, ctx, 'ACTION_FAILED', 'The action could not be completed in the page.', true);
  }

  ctx.idempotency.set(request.action_id, result);
  return result;
}
