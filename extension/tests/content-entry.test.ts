import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEnvelope, okResponse } from '../src/shared/messages';
import {
  handleContentMessage,
  type ContentRuntimeContext,
} from '../src/content/rpc/handlers';

const CONTEXT: ContentRuntimeContext = {
  document_id: 'doc-1',
  url: 'https://shop.example/products',
  title: 'Shop',
};

function provide(): ContentRuntimeContext {
  return CONTEXT;
}

describe('handleContentMessage', () => {
  it('answers PING_CONTENT_RUNTIME with the current document context', () => {
    const envelope = buildEnvelope('PING_CONTENT_RUNTIME', {});
    const response = handleContentMessage(envelope, provide);
    expect(response).toEqual(
      okResponse(envelope.request_id, {
        document_id: 'doc-1',
        url: 'https://shop.example/products',
        title: 'Shop',
      }),
    );
  });

  it('rejects protocol version mismatches', () => {
    const response = handleContentMessage(
      { protocol_version: 99, request_id: 'x', type: 'PING_CONTENT_RUNTIME', payload: {} },
      provide,
    );
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('RPC_VALIDATION_FAILED');
  });

  it('rejects message types the content runtime does not implement yet', () => {
    const response = handleContentMessage(buildEnvelope('OBSERVE_PAGE', {}), provide);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('RPC_VALIDATION_FAILED');
  });

  it('rejects unknown types outright', () => {
    const response = handleContentMessage(
      { protocol_version: 1, request_id: 'x', type: 'EVAL_THIS', payload: { code: 'alert(1)' } },
      provide,
    );
    expect(response.ok).toBe(false);
  });

  it('rejects malformed messages safely', () => {
    expect(handleContentMessage(undefined, provide).ok).toBe(false);
    expect(handleContentMessage(null, provide).ok).toBe(false);
  });
});

describe('content runtime registration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('location', { href: 'https://shop.example/cart' });
    vi.stubGlobal('document', { title: 'Cart' });
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fakeChrome() {
    return {
      runtime: {
        id: 'fake-extension-id',
        onMessage: { addListener: vi.fn() },
      },
    };
  }

  it('registers a message listener that answers pings', async () => {
    const fake = fakeChrome();
    vi.stubGlobal('chrome', fake);
    await import('../src/content/entry');

    expect(fake.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    const listener = fake.runtime.onMessage.addListener.mock.calls[0][0] as (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void,
    ) => boolean;

    const sendResponse = vi.fn();
    const keepOpen = listener(
      buildEnvelope('PING_CONTENT_RUNTIME', {}),
      { id: 'fake-extension-id' } as chrome.runtime.MessageSender,
      sendResponse,
    );
    expect(keepOpen).toBe(false);
    expect(sendResponse).toHaveBeenCalledTimes(1);
    const response = sendResponse.mock.calls[0][0] as { ok: true; data: { url: string; title: string } };
    expect(response.data.url).toBe('https://shop.example/cart');
    expect(response.data.title).toBe('Cart');
  });

  it('keeps document_id stable within a document and changes it after reload (re-init)', async () => {
    const fake = fakeChrome();
    vi.stubGlobal('chrome', fake);
    await import('../src/content/entry');
    const listener = fake.runtime.onMessage.addListener.mock.calls[0][0] as (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void,
    ) => boolean;

    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      listener(buildEnvelope('PING_CONTENT_RUNTIME', {}), { id: 'fake-extension-id' } as chrome.runtime.MessageSender, (response) => {
        ids.push((response as { ok: true; data: { document_id: string } }).data.document_id);
      });
    }
    expect(ids[0]).toBe(ids[1]);

    // Simulate navigation: a fresh module instance is a fresh document.
    vi.resetModules();
    const fake2 = fakeChrome();
    vi.stubGlobal('chrome', fake2);
    await import('../src/content/entry');
    const listener2 = fake2.runtime.onMessage.addListener.mock.calls[0][0] as (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void,
    ) => boolean;
    let newId = '';
    listener2(buildEnvelope('PING_CONTENT_RUNTIME', {}), { id: 'fake-extension-id' } as chrome.runtime.MessageSender, (response) => {
      newId = (response as { ok: true; data: { document_id: string } }).data.document_id;
    });
    expect(newId).not.toBe(ids[0]);
  });

  it('ignores messages from other content scripts or foreign senders', async () => {
    const fake = fakeChrome();
    vi.stubGlobal('chrome', fake);
    await import('../src/content/entry');
    const listener = fake.runtime.onMessage.addListener.mock.calls[0][0] as (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void,
    ) => boolean;

    const sendResponse = vi.fn();
    const result = listener(
      buildEnvelope('PING_CONTENT_RUNTIME', {}),
      { id: 'fake-extension-id', tab: { id: 1 } } as chrome.runtime.MessageSender,
      sendResponse,
    );
    expect(result).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();

    const foreign = listener(
      buildEnvelope('PING_CONTENT_RUNTIME', {}),
      { id: 'someone-else' } as chrome.runtime.MessageSender,
      sendResponse,
    );
    expect(foreign).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
