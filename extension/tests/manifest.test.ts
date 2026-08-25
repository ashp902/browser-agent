// Guard test: the shipped manifest must stay inside the frozen MVP permission
// policy (docs/01 §3, ADR-003). A failure here means an architecture change was
// attempted without a decision record.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED_PERMISSIONS = ['activeTab', 'scripting', 'sidePanel', 'storage'];
const FORBIDDEN_PERMISSIONS = [
  '<all_urls>',
  'debugger',
  'cookies',
  'history',
  'webRequest',
  'webNavigation',
  'downloads',
  'tabCapture',
  'microphone',
];

interface ManifestShape {
  manifest_version: number;
  permissions?: string[];
  host_permissions?: string[];
  background?: { service_worker?: string; type?: string };
  side_panel?: { default_path?: string };
  action?: { default_title?: string };
}

async function loadManifest(): Promise<ManifestShape> {
  const raw = await readFile(path.join(extensionRoot, 'manifest.json'), 'utf8');
  return JSON.parse(raw) as ManifestShape;
}

describe('manifest permission policy', () => {
  it('is Manifest V3', async () => {
    const manifest = await loadManifest();
    expect(manifest.manifest_version).toBe(3);
  });

  it('requests exactly the frozen MVP permission set', async () => {
    const manifest = await loadManifest();
    expect([...(manifest.permissions ?? [])].sort()).toEqual([...ALLOWED_PERMISSIONS].sort());
  });

  it('contains no forbidden permission', async () => {
    const manifest = await loadManifest();
    for (const permission of manifest.permissions ?? []) {
      expect(FORBIDDEN_PERMISSIONS).not.toContain(permission);
    }
    for (const pattern of manifest.host_permissions ?? []) {
      expect(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*']).not.toContain(pattern);
    }
  });

  it('declares service worker, side panel, and action entry points', async () => {
    const manifest = await loadManifest();
    expect(manifest.background?.service_worker).toBe('service-worker.js');
    expect(manifest.background?.type).toBe('module');
    expect(manifest.side_panel?.default_path).toBe('sidepanel.html');
    expect(manifest.action?.default_title).toBeTruthy();
  });
});
