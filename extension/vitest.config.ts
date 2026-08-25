import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts: unit tests run in node and do not need the
// React plugin, which avoids cross-version vite/vitest plugin type coupling.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
