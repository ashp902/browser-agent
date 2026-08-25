import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 900_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'results/artifacts',
  globalSetup: './global-setup.ts',
  webServer: [
    {
      // Deterministic backend for the smoke suite (mock provider, always).
      command: '.venv/bin/python -m uvicorn app.main:app --port 8001',
      cwd: '../backend',
      url: 'http://localhost:8001/healthz',
      reuseExistingServer: true,
      timeout: 60_000,
      env: { LLM_PROVIDER: 'mock' },
    },
    {
      // Operator-configurable backend for evals (mock unless LLM_* is set).
      command: '.venv/bin/python -m uvicorn app.main:app --port 8000',
      cwd: '../backend',
      url: 'http://localhost:8000/healthz',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      cwd: '../test-site',
      url: 'http://localhost:5173/',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
