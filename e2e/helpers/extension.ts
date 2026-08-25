// Extension E2E helpers (docs/08 §7).
//
// Loads the unpacked extension into a persistent Chromium context, resolves
// the extension ID from its service worker, and opens the side panel page as
// an addressable tab. Tasks are driven through the real UI; assertions run
// against reference-site state through window.__SHOP_HARNESS__.

import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXTENSION_DIST = path.join(e2eRoot, '../extension/dist');
export const SITE_ORIGIN = 'http://localhost:5173';
/** Smoke backend: pinned to the deterministic mock provider. */
export const SMOKE_BACKEND_WS = 'ws://localhost:8001/v1/agent/ws';
/** Eval backend: operator-configured via LLM_* env vars. */
export const EVAL_BACKEND_WS = 'ws://localhost:8000/v1/agent/ws';

export interface Session {
  context: BrowserContext;
  site: Page;
  panel: Page;
}

export async function launchSession(
  backendWsUrl: string = SMOKE_BACKEND_WS,
): Promise<Session> {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_DIST}`,
      `--load-extension=${EXTENSION_DIST}`,
    ],
  });

  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  }
  const extensionId = new URL(worker.url()).host;

  const site = await context.newPage();
  await site.goto(`${SITE_ORIGIN}/products`);
  await resetShop(site);

  const panel = await context.newPage();
  await panel.goto(
    `chrome-extension://${extensionId}/sidepanel.html?backend=${encodeURIComponent(backendWsUrl)}`,
  );
  await expect(panel.locator('[aria-label="Task"] p').first()).toContainText('State:');

  // The active tab must be the observed page whenever the agent acts.
  await site.bringToFront();

  return { context, site, panel };
}

export async function resetShop(site: Page): Promise<void> {
  await site.evaluate(() => window.__SHOP_HARNESS__.reset());
}

async function readState(panel: Page): Promise<string> {
  return (
    (await panel.locator('[aria-label="Task"] p').first().innerText())
      .replace('State:', '')
      .trim()
  );
}

export type TerminalState = 'COMPLETED' | 'FAILED' | 'CANCELED';
const TERMINAL: TerminalState[] = ['COMPLETED', 'FAILED', 'CANCELED'];

export async function waitForTerminal(panel: Page, timeoutMs = 120_000): Promise<TerminalState> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  for (;;) {
    last = await readState(panel);
    if (TERMINAL.includes(last as TerminalState)) {
      return last as TerminalState;
    }
    if (Date.now() > deadline) {
      throw new Error(`Task did not reach a terminal state within ${timeoutMs} ms (last: ${last}).`);
    }
    await panel.waitForTimeout(300);
  }
}

export async function startTask(panel: Page, goal: string): Promise<void> {
  await panel.getByLabel('Goal').fill(goal);
  await panel.getByRole('button', { name: 'Start task' }).click();
}

export async function stopTask(panel: Page): Promise<void> {
  await panel.getByRole('button', { name: 'Stop' }).click();
}

export interface HarnessSnapshot {
  cart: unknown[];
  placedOrderIds: string[];
  returns: unknown[];
  loggedIn: boolean;
}

export async function harnessSnapshot(site: Page): Promise<HarnessSnapshot> {
  return site.evaluate(() => ({
    cart: window.__SHOP_HARNESS__.getCart() as unknown[],
    placedOrderIds: window.__SHOP_HARNESS__.getPlacedOrderIds(),
    returns: window.__SHOP_HARNESS__.getReturns() as unknown[],
    loggedIn: window.__SHOP_HARNESS__.isLoggedIn(),
  }));
}

export async function transcriptLines(panel: Page): Promise<string[]> {
  return panel.locator('[aria-label="Task transcript"] li').allInnerTexts();
}
