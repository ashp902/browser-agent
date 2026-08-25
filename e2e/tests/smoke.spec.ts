// Smoke suite: proves the full mechanical chain
// backend -> extension -> page -> backend -> extension with the deterministic
// mock provider. Runs in CI without any model credentials.

import { test, expect } from '@playwright/test';

import {
  launchSession,
  startTask,
  stopTask,
  waitForTerminal,
  transcriptLines,
  type Session,
} from '../helpers/extension';

let session: Session;

test.beforeEach(async () => {
  session = await launchSession();
});

test.afterEach(async () => {
  if (session) await session.context.close();
});

test('mock agent completes a full traversal through the real page', async () => {
  const { panel, site } = session;
  await startTask(panel, 'Demonstrate one action on this page.');

  // The mock strategy clicks the first Buy button it sees, then finishes.
  const state = await waitForTerminal(panel);
  expect(state).toBe('COMPLETED');

  const lines = await transcriptLines(panel);
  expect(lines.some((line) => line.includes('Clicked'))).toBe(true);

  // The page actually received the click: the cart badge shows one item.
  await expect(site.getByRole('link', { name: /Cart \(1\)/ })).toBeVisible();
});

test('cancellation stops a running task', async () => {
  const { panel } = session;
  await startTask(panel, '[slow] Demonstrate cancellation.');
  await stopTask(panel);
  const state = await waitForTerminal(panel);
  expect(['CANCELED', 'FAILED']).toContain(state);
});
