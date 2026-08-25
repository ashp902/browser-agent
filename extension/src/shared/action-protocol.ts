// Browser action protocol contracts (docs/03 §4-§18).
//
// The model never receives these raw: the orchestrator/policy layer constructs
// validated requests. The executor is the only code that touches the page.
// These types cross the content boundary toward the service worker and later
// the backend wire protocol (docs/05 §7 action_request).

export const BROWSER_TOOLS = [
  'click_element',
  'set_text',
  'select_option',
  'set_checked',
  'press_key',
  'scroll_page',
  'scroll_element',
  'navigate_current_tab',
  'go_back',
] as const;

export type BrowserToolName = (typeof BROWSER_TOOLS)[number];

export function isBrowserToolName(value: unknown): value is BrowserToolName {
  return typeof value === 'string' && (BROWSER_TOOLS as readonly string[]).includes(value);
}

import type { SemanticFingerprint } from './semantic-contracts';

/** One browser action request (docs/03 §4). */
export interface BrowserActionRequest {
  protocol_version: 1;
  action_id: string;
  document_id: string;
  observed_mutation_epoch: number;
  tool: BrowserToolName;
  args: Record<string, unknown>;
  expected_target?: SemanticFingerprint;
  /** docs/03 §20 / docs/05 §7: present only for user-approved consequential
   * actions. The executor verifies the binding before touching the page. */
  confirmation_token?: string;
}

/**
 * Executor-level failure codes (docs/00 §3.6). DOCUMENT_CHANGED is mandated by
 * docs/03 §3 for document-identity mismatches and completes the set.
 */
export type ActionErrorCode =
  | 'STALE_TARGET'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_NOT_VISIBLE'
  | 'TARGET_DISABLED'
  | 'UNSUPPORTED_TARGET'
  | 'INVALID_ARGUMENT'
  | 'PERMISSION_REQUIRED'
  | 'NAVIGATION_BLOCKED'
  | 'DOCUMENT_CHANGED'
  | 'ACTION_FAILED';

export interface ActionError {
  code: ActionErrorCode;
  message: string;
  retryable?: boolean;
}

/** Structured result for exactly one action (docs/03 §18). */
export interface ActionResult {
  protocol_version: 1;
  action_id: string;
  document_id: string;
  mutation_epoch_before: number;
  mutation_epoch_after: number;
  ok: boolean;
  changed?: boolean;
  summary: string;
  data?: Record<string, unknown>;
  error?: ActionError;
}

/** Side-panel -> worker payload for EXECUTE_ACTIVE_PAGE_ACTION. */
export interface ExecuteActivePageActionPayload {
  tool: BrowserToolName;
  args: Record<string, unknown>;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isBrowserActionRequest(value: unknown): value is BrowserActionRequest {
  if (!isPlainObject(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.protocol_version === 1 &&
    typeof c.action_id === 'string' &&
    c.action_id.length > 0 &&
    typeof c.document_id === 'string' &&
    c.document_id.length > 0 &&
    typeof c.observed_mutation_epoch === 'number' &&
    c.observed_mutation_epoch >= 0 &&
    isBrowserToolName(c.tool) &&
    isPlainObject(c.args) &&
    // JSON transports surface absent optionals as null rather than undefined.
    (c.expected_target === undefined || c.expected_target === null || isPlainObject(c.expected_target)) &&
    (c.confirmation_token === undefined || c.confirmation_token === null || typeof c.confirmation_token === 'string')
  );
}

export function isActionResult(value: unknown): value is ActionResult {
  if (!isPlainObject(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.protocol_version === 1 &&
    typeof c.action_id === 'string' &&
    typeof c.document_id === 'string' &&
    typeof c.mutation_epoch_before === 'number' &&
    typeof c.mutation_epoch_after === 'number' &&
    typeof c.ok === 'boolean' &&
    typeof c.summary === 'string'
  );
}

/** Payload validator used by both sides of the local messaging boundary. */
export function validateExecuteActionPayload(
  payload: unknown,
): { ok: true; payload: ExecuteActivePageActionPayload } | { ok: false; reason: string } {
  if (!isPlainObject(payload)) return { ok: false, reason: 'payload must be an object' };
  if (!isBrowserToolName(payload.tool)) return { ok: false, reason: 'unknown tool' };
  if (!isPlainObject(payload.args)) return { ok: false, reason: 'args must be an object' };
  return { ok: true, payload: { tool: payload.tool, args: payload.args } };
}

// ---------------------------------------------------------------------------
// Confirmation binding tokens (docs/06 §9, docs/03 §20)
//
// Base64url JSON binding an approval to action id, document id, target
// element/fingerprint, and expiry. The executor decodes and compares every
// binding field against the incoming request before acting.
//
// MVP limitation (documented in docs/06 §12): tokens are un-signed because no
// shared secret/auth identity exists yet.
// ---------------------------------------------------------------------------

export interface ConfirmationTokenFields {
  action_id: string;
  document_id: string;
  element_id: number | null;
  expected_target: SemanticFingerprint | null;
  expires_at_ms: number;
}

function base64UrlDecode(token: string): string {
  const padded = token.replace(/-/g, '+').replace(/_/g, '/');
  const paddedLength = padded.length + ((4 - (padded.length % 4)) % 4);
  const standard = padded.padEnd(paddedLength, '=');
   
  return atob(standard);
}

export function decodeConfirmationToken(token: string): ConfirmationTokenFields | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(token));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.action_id !== 'string' ||
      typeof candidate.document_id !== 'string' ||
      typeof candidate.expires_at_ms !== 'number'
    ) {
      return null;
    }
    return {
      action_id: candidate.action_id,
      document_id: candidate.document_id,
      element_id: typeof candidate.element_id === 'number' ? candidate.element_id : null,
      expected_target:
        typeof candidate.expected_target === 'object' && candidate.expected_target !== null
          ? (candidate.expected_target as SemanticFingerprint)
          : null,
      expires_at_ms: candidate.expires_at_ms,
    };
  } catch {
    return null;
  }
}

function fingerprintsEqual(a: SemanticFingerprint, b: SemanticFingerprint): boolean {
  return (
    a.role === b.role &&
    a.normalized_name === b.normalized_name &&
    a.tag_name === b.tag_name &&
    (a.input_type ?? null) === (b.input_type ?? null) &&
    (a.href_origin ?? null) === (b.href_origin ?? null)
  );
}

/**
 * Verifies a confirmation token binds THIS exact request and has not expired.
 * Returns null when valid, otherwise a violation reason (docs/03 §20).
 */
export function verifyConfirmationToken(
  token: string | undefined,
  request: BrowserActionRequest,
  nowMs: number = Date.now(),
): string | null {
  if (token === undefined || token === '') {
    return 'missing confirmation token';
  }
  const fields = decodeConfirmationToken(token);
  if (fields === null) return 'malformed confirmation token';
  if (fields.action_id !== request.action_id) return 'bound to a different action';
  if (fields.document_id !== request.document_id) return 'bound to a different document';

  const requestElementId =
    typeof request.args['element_id'] === 'number' ? (request.args['element_id'] as number) : null;
  if (fields.element_id !== requestElementId) return 'bound to a different target element';

  if (fields.expected_target === null || request.expected_target === undefined) {
    if (fields.expected_target !== request.expected_target) {
      return 'bound to a different target fingerprint';
    }
  } else if (!fingerprintsEqual(fields.expected_target, request.expected_target)) {
    return 'bound to a different target fingerprint';
  }

  if (nowMs > fields.expires_at_ms) return 'confirmation expired';
  return null;
}
