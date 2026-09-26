import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { existsSync, readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

// The Android build only applies the Firebase plugin when google-services.json
// is present (see android/app/build.gradle). Without it, calling FCM register()
// throws natively and kills the app, so the web layer must know not to try.
const hasFirebaseConfig = existsSync(path.resolve(__dirname, 'android/app/google-services.json'));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Electron loads index.html through file://, so all bundled asset URLs must
  // be relative. Accept either the build script's env flag or Vite's mode to
  // keep direct/release builds from silently producing a blank window.
  base: process.env.ELECTRON === '1' || mode === 'electron' ? './' : '/',
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
    __KANT_VERSION__: JSON.stringify(pkg.version),
    __KANT_FCM__: JSON.stringify(hasFirebaseConfig),
    'import.meta.env.VITE_RELAY_URL': JSON.stringify(process.env.VITE_RELAY_URL ?? ''),
    'import.meta.env.VITE_RELAY_HTTP_PORT': JSON.stringify(process.env.VITE_RELAY_HTTP_PORT ?? '3001'),
  }
}));
