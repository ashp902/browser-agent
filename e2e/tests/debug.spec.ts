import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const resultsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../results');
import { launchSession, startTask, waitForTerminal, transcriptLines } from '../helpers/extension';

test('debug dump', async () => {
  const session = await launchSession();
  for (const worker of session.context.serviceWorkers()) {
    worker.on('console', (message) => console.log('[SW]', message.text()));
  }
  session.context.on('serviceworker', (worker) =>
    worker.on('console', (message) => console.log('[SW]', message.text())),
  );
  session.panel.on('websocket', (ws) => {
    ws.on('framesent', (f) => fs.appendFileSync(path.join(resultsDir, 'frames.log'), String(f.payload) + '\n'));
    ws.on('framereceived', (f) => fs.appendFileSync(path.join(resultsDir, 'frames.log'), String(f.payload) + '\n'));
  });
  await startTask(session.panel, 'Demonstrate one action on this page.');
  const state = await waitForTerminal(session.panel);
  console.log('FINAL STATE:', state);
  console.log('TRANSCRIPT:');
  for (const line of await transcriptLines(session.panel)) console.log('  |', line);
  await session.context.close();
});
