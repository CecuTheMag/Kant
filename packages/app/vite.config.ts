import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ['require', 'default'],
    alias: {
      '@kant/core': path.resolve(__dirname, '../core/src'),
    }
  },

  define: {
    global: 'globalThis'
  }
});
