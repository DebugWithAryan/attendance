import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in dev, so the API needs no CORS exception for the browser.
    proxy: { '/api': 'http://localhost:4000', '/files': 'http://localhost:4000' },
  },
  // `vite preview` needs its own proxy; it does not inherit server.proxy.
  preview: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000', '/files': 'http://localhost:4000' },
  },
  build: { outDir: 'dist', sourcemap: false },
});
