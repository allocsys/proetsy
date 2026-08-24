import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split out third-party deps (react, radix/base-ui primitives, icons, etc.) from
        // app code so app changes don't invalidate the (much larger, rarely-changing)
        // vendor bundle, and so the single-file output no longer trips Vite's default
        // 500kb chunk-size warning.
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-ui': ['@base-ui/react', 'lucide-react', 'sonner', 'next-themes'],
        },
      },
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
