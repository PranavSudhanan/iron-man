import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true, port: 5173, hmr: { overlay: false } },
  build: { chunkSizeWarningLimit: 1200 },
});
