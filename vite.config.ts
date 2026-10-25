import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  publicDir: 'public',
  envDir: '../..',
  build: { outDir: '../../dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: {
    host: true,
    port: 5173,
    proxy: { '/ws': { target: 'ws://localhost:3000', ws: true } },
  },
});
