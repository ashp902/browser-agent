import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEnvelope, okResponse, errorResponse } from '../src/shared/messages';
import type { LocalError } from '../src/shared/errors';

// Service-worker module functions reference the global `chrome` at call time;
// tests install a fake before each use (docs/08 §3 messaging suite).

const EXTENSION_ID = 'fake-extension-id';
const TAB_ID = 42;
const TAB_URL = 'https://shop.example/products';
const DOCUMENT_ID = 'doc-uuid-1';

function pingOk() {
  return okResponse('any', { document_id: DOCUMENT_ID, url: TAB_URL, title: 'Shop' });
}

interface FakeChromeOptions {
  tabs?: chrome.tabs.Tab[];
  tabGetError?: Error;
  sendMessageImpl?: (tabId: number, message: unknown) => Promise<unknown>;
  executeScriptError?: Error;
}

function makeFakeChrome(options: FakeChromeOptions = {}) {
  const tabs: chrome.tabs.Tab[] =
    options.tabs ?? [{ id: TAB_ID, url: TAB_URL, title: 'Shop', active: true, index: 0, pinned: false, highlighted: false, windowId: 1, incognito: false, selected: false, discarded: false, autoDiscardable: true, groupId: -1, status: 'complete', frozen: false } as chrome.tabs.Tab];
  return {
    runtime: {
      id: EXTENSION_ID,
      getURL: (path: string) => `chrome-extension://${EXTENSION_ID}/${path}`,
      getManifest: () => ({ version: '0.1.0', name: 'Browser Agent', manifest_version: 3 }),
      onMessage: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(async () => tabs),
      get: vi.fn(async (tabId: number) => {
        if (options.tabGetError) throw options.tabGetError;
        const tab = tabs.find((t) => t.id === tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        return tab;
      }),
      sendMessage: vi.fn(options.sendMessageImpl ?? (async () => pingOk())),
    },
    scripting: {
      executeScript: vi.fn(async () => {
        if (options.executeScriptError) throw options.executeScriptError;
        return [];
      }),
    },
    sidePanel: {
      setPanelBehavior: vi.fn(async () => undefined),
    },
  };
}

let chrome_fake: ReturnType<typeof makeFakeChrome>;
let sw: typeof import('../src/background/service-worker');

beforeEach(async () => {
  chrome_fake = makeFakeChrome();
  vi.stubGlobal('chrome', chrome_fake);
  sw = await import('../src/background/service-worker');
});

const panelSender = { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/sidepanel.html` } as chrome.runtime.MessageSender;

describe('getActiveTab', () => {
  it('returns the active tab', async () => {
    const result = await sw.getActiveTab();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe(TAB_ID);
  });

  it('returns NO_ACTIVE_TAB when no tab is active', async () => {
    vi.stubGlobal('chrome', makeFakeChrome({ tabs: [] }));
    const result = await sw.getActiveTab();
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'NO_ACTIVE_TAB' }) });
  });
});

describe('sendContentRequest', () => {
  it('returns typed data for a valid response', async () => {
    const result = await sw.sendContentRequest(TAB_ID, buildEnvelope('PING_CONTENT_RUNTIME', {}));
    expect(result.ok).toBe(true);
  });

  it('rejects malformed content responses', async () => {
    vi.stubGlobal('chrome', makeFakeChrome({ sendMessageImpl: async () => ({ garbage: true }) }));
    sw = await import('../src/background/service-worker');
    const result = await sw.sendContentRequest(TAB_ID, buildEnvelope('PING_CONTENT_RUNTIME', {}));
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'RPC_VALIDATION_FAILED' }) });
  });

  it('propagates typed content errors', async () => {
    const error: LocalError = { code: 'ACTION_FAILED', message: 'nope' };
    vi.stubGlobal('chrome', makeFakeChrome({ sendMessageImpl: async () => errorResponse('x', error) }));
    sw = await import('../src/background/service-worker');
    const result = await sw.sendContentRequest(TAB_ID, buildEnvelope('PING_CONTENT_RUNTIME', {}));
    expect(result).toEqual({ ok: false, error });
  });

  it('maps a hung receiver to LOCAL_TIMEOUT', async () => {
    vi.stubGlobal(
      'chrome',
      makeFakeChrome({ sendMessageImpl: () => new Promise<never>(() => undefined) }),
    );
    sw = await import('../src/background/service-worker');
    const result = await sw.sendContentRequest(TAB_ID, buildEnvelope('PING_CONTENT_RUNTIME', {}), 20);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'LOCAL_TIMEOUT' }) });
  });
});

describe('ensureContentRuntime', () => {
  it('reuses a live runtime without injecting', async () => {
    const result = await sw.ensureContentRuntime(TAB_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.document_id).toBe(DOCUMENT_ID);
    expect(chrome_fake.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('injects the bundled content script when no receiver exists, then pings', async () => {
    let calls = 0;
    vi.stubGlobal(
      'chrome',
      makeFakeChrome({
        sendMessageImpl: async () => {
          calls += 1;
          if (calls === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
          return pingOk();
        },
      }),
    );
    const fresh = await import('../src/background/service-worker');
    const result = await fresh.ensureContentRuntime(TAB_ID);
    expect(result.ok).toBe(true);
    const chromeNow = chrome as unknown as ReturnType<typeof makeFakeChrome>;
    expect(chromeNow.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: TAB_ID },
      files: ['content-entry.js'],
    });
  });

  it('returns PERMISSION_REQUIRED when injection is denied', async () => {
    vi.stubGlobal(
      'chrome',
      makeFakeChrome({
        sendMessageImpl: async () => {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        },
        executeScriptError: new Error('Cannot access contents of the page. Extension manifest must request permission.'),
      }),
    );
    const fresh = await import('../src/background/service-worker');
    const result = await fresh.ensureContentRuntime(TAB_ID);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'PERMISSION_REQUIRED' }) });
  });

  it('returns CONTENT_RUNTIME_UNAVAILABLE when the runtime never answers', async () => {
    vi.stubGlobal(
      'chrome',
      makeFakeChrome({
        sendMessageImpl: async () => {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        },
      }),
    );
    const fresh = await import('../src/background/service-worker');
    const result = await fresh.ensureContentRuntime(TAB_ID);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'CONTENT_RUNTIME_UNAVAILABLE' }) });
  });

  it('returns UNSUPPORTED_URL for protected pages without attempting injection', async () => {
    vi.stubGlobal(
      'chrome',
      makeFakeChrome({ tabs: [{ id: TAB_ID, url: 'chrome://extensions', title: 'Extensions' } as chrome.tabs.Tab] }),
    );
    const fresh = await import('../src/background/service-worker');
    const result = await fresh.ensureContentRuntime(TAB_ID);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'UNSUPPORTED_URL' }) });
    const chromeNow = chrome as unknown as ReturnType<typeof makeFakeChrome>;
    expect(chromeNow.scripting.executeScript).not.toHaveBeenCalled();
  });
});

describe('handlePanelMessage', () => {
  it('rejects messages from foreign senders', async () => {
    const response = await sw.handlePanelMessage(buildEnvelope('GET_ACTIVE_CONTEXT', {}), {
      id: 'other-extension',
      url: 'chrome-extension://other-extension/sidepanel.html',
    } as chrome.runtime.MessageSender);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('RPC_VALIDATION_FAILED');
  });

  it('rejects messages from our own extension that are not the side panel', async () => {
    const response = await sw.handlePanelMessage(buildEnvelope('GET_ACTIVE_CONTEXT', {}), {
      id: EXTENSION_ID,
      url: `chrome-extension://${EXTENSION_ID}/other.html`,
    } as chrome.runtime.MessageSender);
    expect(response.ok).toBe(false);
  });

  it('rejects non-envelope messages', async () => {
    const response = await sw.handlePanelMessage('hello', panelSender);
    expect(response.ok).toBe(false);
  });

  it('rejects known protocol types that are not implemented in this build', async () => {
    const response = await sw.handlePanelMessage(buildEnvelope('OBSERVE_ACTIVE_PAGE', {}), panelSender);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('RPC_VALIDATION_FAILED');
  });

  it('rejects non-empty payloads for parameterless messages', async () => {
    const response = await sw.handlePanelMessage(buildEnvelope('GET_ACTIVE_CONTEXT', { tab: 1 }), panelSender);
    expect(response.ok).toBe(false);
  });

  it('returns active tab context with a live document id', async () => {
    const response = await sw.handlePanelMessage(buildEnvelope('GET_ACTIVE_CONTEXT', {}), panelSender);
    expect(response.ok).toBe(true);
    if (response.ok) {
      const data = response.data as { tab: { tab_id: number; url: string }; content_runtime: { document_id: string } };
      expect(data.tab.tab_id).toBe(TAB_ID);
      expect(data.tab.url).toBe(TAB_URL);
      expect(data.content_runtime.document_id).toBe(DOCUMENT_ID);
    }
  });

  it('returns local capabilities', async () => {
    const response = await sw.handlePanelMessage(buildEnvelope('GET_LOCAL_CAPABILITIES', {}), panelSender);
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data).toEqual({ extension_version: '0.1.0', protocol_version: 1 });
    }
  });

  it('returns a semantic observation for OBSERVE_ACTIVE_PAGE', async () => {
    const observation = {
      document_id: 'doc-1',
      snapshot_id: 'snap-1',
      mutation_epoch: 4,
      url: TAB_URL,
      origin: 'https://shop.example',
      title: 'Shop',
      semantic_text: 'PAGE title="Shop" ...',
      actionable_fingerprints: { 3: { role: 'button', normalized_name: 'buy', tag_name: 'button' } },
      stats: { node_count: 5, actionable_count: 1, truncated_nodes: 0, snapshot_truncated: false, serialized_chars: 40 },
    };
    vi.stubGlobal(
      'chrome',
      makeFakeChrome({ sendMessageImpl: async (_tabId, message) => {
        const envelope = message as { type: string };
        return envelope.type === 'OBSERVE_PAGE' ? okResponse('x', observation) : pingOk();
      } }),
    );
    const fresh = await import('../src/background/service-worker');
    const response = await fresh.handlePanelMessage(buildEnvelope('OBSERVE_ACTIVE_PAGE', {}), panelSender);
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data).toMatchObject({ document_id: 'doc-1', mutation_epoch: 4 });
    }
  });

  it('rejects malformed observation payloads', async () => {
    vi.stubGlobal(
      'chrome',
      makeFakeChrome({ sendMessageImpl: async (_tabId, message) => {
        const envelope = message as { type: string };
        return envelope.type === 'OBSERVE_PAGE' ? okResponse('x', { garbage: true }) : pingOk();
      } }),
    );
    const fresh = await import('../src/background/service-worker');
    const response = await fresh.handlePanelMessage(buildEnvelope('OBSERVE_ACTIVE_PAGE', {}), panelSender);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('RPC_VALIDATION_FAILED');
  });

  it('rejects EXECUTE_ACTIVE_PAGE_ACTION until the action milestone', async () => {
    const response = await sw.handlePanelMessage(buildEnvelope('EXECUTE_ACTIVE_PAGE_ACTION', {}), panelSender);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('RPC_VALIDATION_FAILED');
  });

  it('echoes the request id in responses', async () => {
    const envelope = buildEnvelope('GET_ACTIVE_CONTEXT', {});
    const response = await sw.handlePanelMessage(envelope, panelSender);
    expect(response.request_id).toBe(envelope.request_id);
  });
});

describe('service worker registration', () => {
  it('registers side-panel behavior and the message router on load', async () => {
    vi.resetModules();
    const fake = makeFakeChrome();
    vi.stubGlobal('chrome', fake);
    await import('../src/background/service-worker');

    expect(fake.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1);
    expect(fake.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);

    const onInstalled = fake.runtime.onInstalled.addListener.mock.calls[0][0] as () => void;
    onInstalled();
    expect(fake.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });

    const onMessage = fake.runtime.onMessage.addListener.mock.calls[0][0] as (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void,
    ) => boolean;
    const sendResponse = vi.fn();
    const keepOpen = onMessage(buildEnvelope('GET_LOCAL_CAPABILITIES', {}), panelSender, sendResponse);
    expect(keepOpen).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
  });
});
