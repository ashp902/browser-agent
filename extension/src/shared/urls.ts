// URL support classification for page access (docs/01 §16).
//
// Only ordinary web pages are observable/actionable. Protected browser pages
// reject content-script injection; we classify deterministically up front so the
// side panel receives a typed UNSUPPORTED_URL instead of a raw Chrome failure.

export type UrlSupport = { supported: true } | { supported: false; reason: string };

const UNSUPPORTED_SCHEMES = new Set([
  'chrome:',
  'chrome-search:',
  'chrome-untrusted:',
  'edge:',
  'about:',
  'opera:',
  'brave:',
  'view-source:',
  'data:',
  'javascript:',
  'blob:',
  'devtools:',
]);

// Chrome blocks content-script injection into the Web Store regardless of
// permissions.
const UNSUPPORTED_HOSTS = new Set(['chromewebstore.google.com', 'chrome.google.com']);

export function classifyUrlSupport(rawUrl: string | undefined, ownExtensionId?: string): UrlSupport {
  if (!rawUrl) {
    return { supported: false, reason: 'The active tab has no observable URL.' };
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { supported: false, reason: 'The active tab URL is not parseable.' };
  }

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    if (UNSUPPORTED_HOSTS.has(url.hostname)) {
      return { supported: false, reason: 'The Chrome Web Store does not allow page access.' };
    }
    return { supported: true };
  }

  // file:// pages work only when the user has explicitly allowed file access;
  // we let the injection attempt surface PERMISSION_REQUIRED in that case.
  if (url.protocol === 'file:') {
    return { supported: true };
  }

  if (url.protocol === 'chrome-extension:') {
    // Spec excludes other extensions' pages (docs/01 §16). Our own extension
    // pages are technically injectable but never a useful agent target.
    if (ownExtensionId !== undefined && url.hostname === ownExtensionId) {
      return { supported: false, reason: 'The Browser Agent panel is not an observable page.' };
    }
    return { supported: false, reason: 'Pages belonging to another extension are not accessible.' };
  }

  if (UNSUPPORTED_SCHEMES.has(url.protocol)) {
    return { supported: false, reason: `Browser-internal pages (${url.protocol}//) are not accessible.` };
  }

  return { supported: false, reason: `Unsupported URL scheme: ${url.protocol}` };
}
