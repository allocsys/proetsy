import { defineConfig } from 'vitest/config';

// Scoped to electron/ only -- see this file's commit message for why. backend/ and
// frontend/ each already run their own tests via their own workspace-local Vitest setup
// (backend/package.json's `test` script; frontend/vitest.config.js); this config must not
// overlap with either.
export default defineConfig({
  test: {
    include: ['electron/**/*.test.js'],
    environment: 'node',
    // Without this, Vitest's default externalization heuristics treat 'electron' (a
    // plain CJS npm package) as external -- its require('electron') call then goes
    // through Node's native loader directly, bypassing Vitest's mock-aware module
    // graph, so electron/main.test.js's vi.mock('electron', ...) never takes effect.
    // Forcing it inline routes require('electron') through Vitest's own transform
    // pipeline instead, where the mock registry can actually intercept it.
    server: {
      deps: {
        inline: ['electron'],
      },
    },
  },
});
