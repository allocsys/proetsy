import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vitest config, separate from vite.config.js so `npm run build`/`npm run dev`
// (the existing scripts) don't pick up test-only settings. jsdom environment since
// these are component tests (DOM APIs like fetch mocking, click events, etc.).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
});
