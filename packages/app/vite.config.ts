import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@kant/core': path.resolve(__dirname, '../core/src'),
      'libsodium-wrappers': path.resolve(
        __dirname,
        '../core/node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js'
      )
    }
  },
  define: {
    global: 'globalThis'
  }
});
