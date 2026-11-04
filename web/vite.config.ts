import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  // near-seed-phrase (12-word recovery phrases) uses Node's Buffer, process and crypto.
  plugins: [react(), nodePolyfills({ globals: { Buffer: true, process: true }, include: ['buffer', 'process', 'crypto', 'stream', 'util', 'events'] })],
  server: {
    port: 5188,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
    proxy: { '/api': process.env.VITE_API_PROXY ?? 'http://localhost:3001' },
  },
  build: {
    outDir: fileURLToPath(new URL('../dist/web', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom'], near: ['near-api-js'], wallets: ['@hot-labs/near-connect'] } } },
  },
});
