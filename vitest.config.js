import { defineConfig } from 'vitest/config';

// Scoped to electron/ only -- see this file's commit message for why. backend/ and
// frontend/ each already run their own tests via their own workspace-local Vitest setup
// (backend/package.json's `test` script; frontend/vitest.config.js); this config must not
// overlap with either.
export default defineConfig({
  test: {
    include: ['electron/**/*.test.js'],
    environment: 'node',
  },
});
