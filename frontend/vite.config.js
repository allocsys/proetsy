import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
      '/mockup-files': 'http://localhost:4000',
      '/artwork-files': 'http://localhost:4000',
    },
  },
});
