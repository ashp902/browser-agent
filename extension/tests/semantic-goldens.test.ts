// @vitest-environment jsdom
// Golden semantic fixtures (docs/02 §22, docs/08 §5).
//
// Each fixture directory contains page.html and expected.semantic.txt. A
// serializer/extractor change that alters goldens requires intentional review:
// regenerate only via `npm run goldens:update`, then review the diff before
// committing. Never bulk-update goldens to make failing tests pass.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_SNAPSHOT_SERIALIZED_CHARS } from '../src/content/semantic/types';

const fixturesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

const UPDATE_GOLDENS = process.env.UPDATE_GOLDENS === '1';

interface Fixture {
  name: string;
  html: string;
  expectedPath: string;
}

function discoverFixtures(): Fixture[] {
  return readdirSync(fixturesRoot)
    .filter((entry) => statSync(path.join(fixturesRoot, entry)).isDirectory())
    .sort()
    .map((name) => ({
      name,
      html: readFileSync(path.join(fixturesRoot, name, 'page.html'), 'utf8'),
      expectedPath: path.join(fixturesRoot, name, 'expected.semantic.txt'),
    }));
}

// Loaded lazily so the node-environment suite file itself stays cheap.
let buildPage: typeof import('./helpers/semantic').buildPage;

beforeAll(async () => {
  ({ buildPage } = await import('./helpers/semantic'));
});

describe.skipIf(UPDATE_GOLDENS)('golden semantic fixtures', () => {
  for (const fixture of discoverFixtures()) {
    it(`matches golden output for ${fixture.name}`, () => {
      const { text } = buildPage(fixture.html);
      const expected = readFileSync(fixture.expectedPath, 'utf8');
      expect(text).toBe(expected);
    });

    // docs/09 Milestone 2 acceptance: semantic text stays under the configured
    // maximum for reference pages.
    it(`keeps ${fixture.name} under the snapshot size budget`, () => {
      const { text } = buildPage(fixture.html);
      expect(text.length).toBeLessThanOrEqual(MAX_SNAPSHOT_SERIALIZED_CHARS);
    });
  }
});

// Regeneration mode: writes expected.semantic.txt files. Output is printed for
// mandatory review (docs/08 §5).
describe.runIf(UPDATE_GOLDENS)('golden fixture regeneration', () => {
  for (const fixture of discoverFixtures()) {
    it(`writes golden output for ${fixture.name}`, () => {
      const { text } = buildPage(fixture.html);
      writeFileSync(fixture.expectedPath, text);
      console.log(`--- ${fixture.name} ---\n${text}`);
    });
  }
});
