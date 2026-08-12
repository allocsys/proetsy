import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
      '/mockup-files': 'http://localhost:4000',
      '/artwork-files': 'http://localhost:4000',
      '/taste-filter-files': 'http://localhost:4000',
    },
  },
});
