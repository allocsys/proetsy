// playwright.config.js (CommonJS — root package.json has no "type": "module", so plain
// .js files at the repo root default to CJS; the actual test files live under e2e/,
// which has its own package.json scoping them to ESM).
//
// See ARCHITECTURE.md -> Testing & CI/CD -> "A small set of Playwright end-to-end tests
// covering the critical path only". Spins up both the backend and frontend exactly the
// way `npm run dev` does (same commands, same ports), so there's no separate "test mode"
// server setup to keep in sync with real dev usage — the only difference is the backend
// env below (a throwaway DB file + LLM_PROVIDER=fixture instead of a real Gemini key).
const { defineConfig } = require('@playwright/test');

const BACKEND_PORT = 4000;
const FRONTEND_PORT = 5173;

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // The backend runs a single SQLite file and both webServers are singletons for the
  // whole run — parallel test files would race each other's jobs/rows. The one spec in
  // this suite is intentionally small (critical path only), so this isn't a real cost.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node server.js',
      cwd: 'backend',
      url: `http://localhost:${BACKEND_PORT}/api/health`,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: String(BACKEND_PORT),
        // Throwaway DB file, never the real backend/data/proetsy.db a developer might
        // have running locally. Already covered by .gitignore's "backend/data/*.db".
        DB_PATH: './data/e2e-test.db',
        // See backend/lib/llm/fixture.js — deterministic offline responses, no network
        // call, no Gemini key needed for this run at all.
        LLM_PROVIDER: 'fixture',
        NODE_ENV: 'test',
      },
    },
    {
      command: 'npm run dev',
      cwd: 'frontend',
      url: `http://localhost:${FRONTEND_PORT}`,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
