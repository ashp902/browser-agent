// Shared helpers for semantic extraction tests (Vitest jsdom environment).

import { JSDOM } from 'jsdom';
import { ElementRegistry } from '../../src/content/registry/element-registry';
import { buildPageSnapshot } from '../../src/content/semantic/extractor';
import { serializeSnapshot } from '../../src/content/semantic/serializer';
import type { PageSnapshot } from '../../src/content/semantic/types';

export const TEST_URL = 'https://shop.example/';

export function parseDocument(html: string): Document {
  return new JSDOM(`<!doctype html>${html}`, { url: TEST_URL }).window.document;
}

export interface BuiltPage {
  doc: Document;
  snapshot: PageSnapshot;
  registry: ElementRegistry;
  /** Compact serialization with volatile fields fixed for comparison. */
  text: string;
}

export function buildPage(
  html: string,
  overrides?: Partial<{ mutationEpoch: number }>,
): BuiltPage {
  const doc = parseDocument(html);
  const registry = new ElementRegistry();
  const snapshot = buildPageSnapshot(doc, {
    documentId: 'test-document-id',
    mutationEpoch: overrides?.mutationEpoch ?? 0,
    registry,
    snapshotId: 'test-snapshot-id',
    capturedAtMs: 0,
  });
  const text = serializeSnapshot(snapshot, { snapshotIdOverride: 'test-snapshot-id' });
  return { doc, snapshot, registry, text };
}
