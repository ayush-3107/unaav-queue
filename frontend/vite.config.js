// vite.config.js
import { defineConfig } from 'vite';
import react            from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // In development, proxy /api calls to the Express backend
      // so we don't hit CORS issues locally
      '/api': {
        target:       'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});