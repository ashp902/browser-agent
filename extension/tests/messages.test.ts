import { describe, expect, it } from 'vitest';

import {
  buildEnvelope,
  errorResponse,
  isPingContentResult,
  isRpcResponse,
  okResponse,
  PANEL_TO_WORKER_TYPES,
  validateEmptyPayload,
  validateRpcEnvelope,
  WORKER_TO_CONTENT_TYPES,
} from '../src/shared/messages';

describe('buildEnvelope', () => {
  it('builds a versioned envelope with a unique request id', () => {
    const first = buildEnvelope('GET_ACTIVE_CONTEXT', {});
    const second = buildEnvelope('GET_ACTIVE_CONTEXT', {});
    expect(first.protocol_version).toBe(1);
    expect(first.type).toBe('GET_ACTIVE_CONTEXT');
    expect(first.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.request_id).not.toBe(second.request_id);
  });
});

describe('validateRpcEnvelope', () => {
  it('accepts a well-formed envelope with an allowed type', () => {
    const envelope = buildEnvelope('PING_CONTENT_RUNTIME', {});
    const result = validateRpcEnvelope(envelope, WORKER_TO_CONTENT_TYPES);
    expect(result.ok).toBe(true);
  });

  it('rejects non-object messages', () => {
    for (const bad of [null, undefined, 42, 'PING', []]) {
      const result = validateRpcEnvelope(bad, PANEL_TO_WORKER_TYPES);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects unsupported protocol versions', () => {
    const result = validateRpcEnvelope(
      { protocol_version: 2, request_id: 'x', type: 'GET_ACTIVE_CONTEXT', payload: {} },
      PANEL_TO_WORKER_TYPES,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('RPC_VALIDATION_FAILED');
  });

  it('rejects unknown message types', () => {
    const result = validateRpcEnvelope(
      { protocol_version: 1, request_id: 'x', type: 'RUN_ARBITRARY_JS', payload: {} },
      PANEL_TO_WORKER_TYPES,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects panel types sent to the content runtime and vice versa', () => {
    const toContent = validateRpcEnvelope(
      { protocol_version: 1, request_id: 'x', type: 'GET_ACTIVE_CONTEXT', payload: {} },
      WORKER_TO_CONTENT_TYPES,
    );
    expect(toContent.ok).toBe(false);
    const toWorker = validateRpcEnvelope(
      { protocol_version: 1, request_id: 'x', type: 'PING_CONTENT_RUNTIME', payload: {} },
      PANEL_TO_WORKER_TYPES,
    );
    expect(toWorker.ok).toBe(false);
  });

  it('rejects envelopes missing request_id or payload', () => {
    expect(
      validateRpcEnvelope({ protocol_version: 1, type: 'GET_ACTIVE_CONTEXT', payload: {} }, PANEL_TO_WORKER_TYPES).ok,
    ).toBe(false);
    expect(
      validateRpcEnvelope(
        { protocol_version: 1, request_id: 'x', type: 'GET_ACTIVE_CONTEXT' },
        PANEL_TO_WORKER_TYPES,
      ).ok,
    ).toBe(false);
  });
});

describe('validateEmptyPayload', () => {
  it('accepts only empty plain objects', () => {
    expect(validateEmptyPayload({})).toBe(true);
    expect(validateEmptyPayload({ a: 1 })).toBe(false);
    expect(validateEmptyPayload([])).toBe(false);
    expect(validateEmptyPayload(null)).toBe(false);
    expect(validateEmptyPayload('')).toBe(false);
  });
});

describe('RpcResponse shapes', () => {
  it('round-trips ok responses', () => {
    const response = okResponse('req-1', { value: 1 });
    expect(isRpcResponse(response)).toBe(true);
  });

  it('round-trips error responses', () => {
    const response = errorResponse('req-1', { code: 'NO_ACTIVE_TAB', message: 'none' });
    expect(isRpcResponse(response)).toBe(true);
    if (response.ok === false) expect(response.error.code).toBe('NO_ACTIVE_TAB');
  });

  it('rejects malformed responses', () => {
    expect(isRpcResponse(null)).toBe(false);
    expect(isRpcResponse({ ok: true })).toBe(false);
    expect(isRpcResponse({ request_id: 'x', ok: 'yes' })).toBe(false);
    expect(isRpcResponse({ request_id: 'x', ok: false, error: { code: 1 } })).toBe(false);
  });
});

describe('isPingContentResult', () => {
  it('accepts only well-formed ping results', () => {
    expect(isPingContentResult({ document_id: 'd', url: 'u', title: 't' })).toBe(true);
    expect(isPingContentResult({ document_id: 'd', url: 'u' })).toBe(false);
    expect(isPingContentResult('ping')).toBe(false);
  });
});
