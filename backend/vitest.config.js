import { defineConfig } from 'vitest/config';

// Workspace-local config for the backend test suite -- see this file's commit message
// for why this needs to exist. Without it, `vitest run` (backend/package.json's `test`
// script) walks up and picks up the repo-root vitest.config.js instead, which is
// deliberately scoped to `electron/**/*.test.js` only and matches nothing here.
export default defineConfig({
  test: {
    include: ['**/*.test.js'],
    exclude: ['node_modules/**', 'lib/__fixtures__/**'],
    environment: 'node',
    testTimeout: 15000,
  },
});
