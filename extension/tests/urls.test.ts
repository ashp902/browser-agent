import { describe, expect, it } from 'vitest';

import { classifyUrlSupport } from '../src/shared/urls';

describe('classifyUrlSupport', () => {
  it('supports ordinary http/https pages including localhost', () => {
    expect(classifyUrlSupport('https://example.com/path?q=1').supported).toBe(true);
    expect(classifyUrlSupport('http://localhost:5173/products').supported).toBe(true);
    expect(classifyUrlSupport('http://127.0.0.1:8000/').supported).toBe(true);
  });

  it('rejects protected browser pages', () => {
    for (const url of [
      'chrome://extensions',
      'chrome://newtab/',
      'edge://settings',
      'about:blank',
      'about:srcdoc',
      'chrome-search://local-ntp',
      'devtools://devtools/bundled/inspector.html',
      'view-source:https://example.com',
    ]) {
      const result = classifyUrlSupport(url);
      expect(result.supported).toBe(false);
    }
  });

  it('rejects the Chrome Web Store (injection blocked by Chrome)', () => {
    expect(classifyUrlSupport('https://chromewebstore.google.com/detail/abc').supported).toBe(false);
    expect(classifyUrlSupport('https://chrome.google.com/webstore/detail/abc').supported).toBe(false);
  });

  it('rejects other extensions and our own extension pages', () => {
    expect(classifyUrlSupport('chrome-extension://other-extension-id/page.html', 'our-id').supported).toBe(false);
    expect(classifyUrlSupport('chrome-extension://our-id/sidepanel.html', 'our-id').supported).toBe(false);
  });

  it('treats file URLs as permission-gated rather than unsupported', () => {
    expect(classifyUrlSupport('file:///tmp/page.html').supported).toBe(true);
  });

  it('rejects unparseable or missing URLs', () => {
    expect(classifyUrlSupport(undefined).supported).toBe(false);
    expect(classifyUrlSupport('not a url').supported).toBe(false);
  });

  it('rejects non-web executable schemes', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<h1>x</h1>', 'blob:https://example.com/id']) {
      expect(classifyUrlSupport(url).supported).toBe(false);
    }
  });
});
