import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds the real UI with an in-browser stand-in for the API, as one HTML file.
export default defineConfig({
  root: 'demo',
  plugins: [react(), viteSingleFile()],
  build: { outDir: '../dist-demo', emptyOutDir: true, assetsInlineLimit: 100000000, cssCodeSplit: false },
});
