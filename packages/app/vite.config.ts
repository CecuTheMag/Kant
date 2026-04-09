import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@kant/core': path.resolve(__dirname, '../core/src'),
      'libsodium-wrappers-sumo': path.resolve(__dirname, '../../node_modules/.pnpm/libsodium-wrappers-sumo@0.8.2/node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js'),
      'libsodium-sumo': path.resolve(__dirname, '../../node_modules/.pnpm/libsodium-sumo@0.8.2/node_modules/libsodium-sumo/dist/modules-sumo/libsodium-sumo.js'),
    }
  },
  optimizeDeps: {
    include: ['libsodium-wrappers-sumo', 'libsodium-sumo'],
  },
  define: {
    global: 'globalThis',
    'import.meta.env.VITE_RELAY_HTTP_PORT': JSON.stringify(process.env.VITE_RELAY_HTTP_PORT ?? '3001'),
  }
});
