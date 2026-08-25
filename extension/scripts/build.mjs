// Build script for the Browser Agent extension.
//
// Produces a loadable unpacked MV3 extension in dist/:
//   1. Vite builds the React side panel (sidepanel.html + assets).
//   2. esbuild bundles the service worker as an ES module and the content
//      script entry as a single classic (IIFE) script.
//   3. manifest.json is validated against the frozen permission policy and
//      copied into dist/.
//
// All executable code is bundled locally; nothing is fetched at runtime
// (docs/06 §14 remote-hosted-code prohibition).

import { rm, copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build as viteBuild } from 'vite';
import * as esbuild from 'esbuild';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(extensionRoot, 'dist');

// Frozen by ADR-003 (docs/12). Changing this set is an architecture change.
const ALLOWED_PERMISSIONS = new Set(['activeTab', 'scripting', 'sidePanel', 'storage']);
const FORBIDDEN_PERMISSIONS = new Set([
  '<all_urls>',
  'debugger',
  'cookies',
  'history',
  'webRequest',
  'webNavigation',
  'downloads',
  'tabCapture',
  'microphone',
]);

function assertManifestPolicy(manifest) {
  const permissions = manifest.permissions ?? [];
  for (const permission of permissions) {
    if (FORBIDDEN_PERMISSIONS.has(permission)) {
      throw new Error(`Forbidden manifest permission: ${permission}`);
    }
    if (!ALLOWED_PERMISSIONS.has(permission)) {
      throw new Error(`Permission not in frozen MVP set: ${permission}`);
    }
  }
  const hostPermissions = manifest.host_permissions ?? [];
  for (const pattern of hostPermissions) {
    if (pattern === '<all_urls>' || pattern === '*://*/*' || pattern === 'http://*/*' || pattern === 'https://*/*') {
      throw new Error(`Host permission too broad for MVP: ${pattern}`);
    }
  }
  if (manifest.manifest_version !== 3) {
    throw new Error('manifest_version must be 3');
  }
}

await rm(distDir, { recursive: true, force: true });

await viteBuild({ configFile: path.join(extensionRoot, 'vite.config.ts') });

await esbuild.build({
  entryPoints: [path.join(extensionRoot, 'src/background/service-worker.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120'],
  outfile: path.join(distDir, 'service-worker.js'),
});

await esbuild.build({
  entryPoints: [path.join(extensionRoot, 'src/content/entry.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120'],
  outfile: path.join(distDir, 'content-entry.js'),
});

const manifestPath = path.join(extensionRoot, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assertManifestPolicy(manifest);
await copyFile(manifestPath, path.join(distDir, 'manifest.json'));

console.log('Extension built to extension/dist');
