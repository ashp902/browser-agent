// Confirmation binding token tests (docs/06 §9, docs/03 §20).
//
// The Python side builds tokens as base64url(JSON) of:
//   {action_id, document_id, element_id, expected_target, expires_at_ms}
// These tests pin the decoder + binding verifier against that exact shape.

import { describe, expect, it } from 'vitest';

import {
  decodeConfirmationToken,
  verifyConfirmationToken,
  type BrowserActionRequest,
} from '../src/shared/action-protocol';
import type { SemanticFingerprint } from '../src/shared/semantic-contracts';

const FINGERPRINT: SemanticFingerprint = {
  role: 'button',
  normalized_name: 'place order',
  tag_name: 'button',
};

function request(overrides?: Partial<BrowserActionRequest>): BrowserActionRequest {
  return {
    protocol_version: 1,
    action_id: 'act-1',
    document_id: 'doc-1',
    observed_mutation_epoch: 7,
    tool: 'click_element',
    args: { element_id: 11 },
    expected_target: FINGERPRINT,
    ...overrides,
  };
}

function encodeToken(fields: Record<string, unknown>): string {
  const raw = JSON.stringify(fields);
  // btoa for ASCII-safe JSON; matches Python base64.urlsafe_b64encode output
  // once '-'/'+' and '_'/'/' are mapped.
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const FUTURE = Date.now() + 60_000;

describe('decodeConfirmationToken', () => {
  it('decodes a backend-shaped token', () => {
    const token = encodeToken({
      action_id: 'act-1',
      document_id: 'doc-1',
      element_id: 11,
      expected_target: FINGERPRINT,
      expires_at_ms: FUTURE,
    });
    const fields = decodeConfirmationToken(token);
    expect(fields).not.toBeNull();
    expect(fields?.action_id).toBe('act-1');
    expect(fields?.element_id).toBe(11);
    expect(fields?.expected_target?.normalized_name).toBe('place order');
  });

  it('rejects malformed tokens', () => {
    expect(decodeConfirmationToken('not-a-token')).toBeNull();
    expect(decodeConfirmationToken('')).toBeNull();
  });
});

describe('verifyConfirmationToken', () => {
  const validToken = encodeToken({
    action_id: 'act-1',
    document_id: 'doc-1',
    element_id: 11,
    expected_target: FINGERPRINT,
    expires_at_ms: FUTURE,
  });

  it('accepts a correctly bound, unexpired token', () => {
    expect(verifyConfirmationToken(validToken, request())).toBeNull();
  });

  it('refuses a missing token', () => {
    expect(verifyConfirmationToken(undefined, request())).toBe('missing confirmation token');
  });

  it('refuses an expired token', () => {
    const expired = encodeToken({
      action_id: 'act-1',
      document_id: 'doc-1',
      element_id: 11,
      expected_target: FINGERPRINT,
      expires_at_ms: Date.now() - 1000,
    });
    expect(verifyConfirmationToken(expired, request())).toBe('confirmation expired');
  });

  it('refuses a token bound to a different action', () => {
    const other = encodeToken({
      action_id: 'act-2',
      document_id: 'doc-1',
      element_id: 11,
      expected_target: FINGERPRINT,
      expires_at_ms: FUTURE,
    });
    expect(verifyConfirmationToken(other, request())).toBe('bound to a different action');
  });

  it('refuses a token bound to a different document', () => {
    const other = encodeToken({
      action_id: 'act-1',
      document_id: 'doc-999',
      element_id: 11,
      expected_target: FINGERPRINT,
      expires_at_ms: FUTURE,
    });
    expect(verifyConfirmationToken(other, request())).toContain('document');
  });

  it('refuses a token bound to a different target fingerprint (changed target)', () => {
    const other = encodeToken({
      action_id: 'act-1',
      document_id: 'doc-1',
      element_id: 12,
      expected_target: { ...FINGERPRINT, normalized_name: 'harmless' },
      expires_at_ms: FUTURE,
    });
    expect(verifyConfirmationToken(other, request())).toContain('target');
  });
});
