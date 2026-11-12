import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import type { Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

// The Android build only applies the Firebase plugin when google-services.json
// is present (see android/app/build.gradle). Without it, calling FCM register()
// throws natively and kills the app, so the web layer must know not to try.
const hasFirebaseConfig = existsSync(path.resolve(__dirname, 'android/app/google-services.json'));

/**
 * Content-Security-Policy for built apps (web, Android, iOS and desktop all
 * load this index.html). Kant renders text and files that other people send,
 * so even though nothing on that path writes HTML, a policy is the backstop:
 * no inline or remote script can run, and nothing can be framed or posted.
 *
 *  - script-src: our own bundle, the one inline theme script (by hash), and
 *    WebAssembly for libsodium. No 'unsafe-inline', no 'unsafe-eval'.
 *  - connect-src: relays are user-chosen (any https/wss host, or http/ws on a
 *    home network), so the network itself can't be narrowed here.
 *  - style-src needs 'unsafe-inline' for React's style attributes.
 *
 * Build only: the dev server injects its own inline scripts.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'kant-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
          .map(m => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
        const policy = [
          `default-src 'self'`,
          `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}`.trim(),
          `style-src 'self' 'unsafe-inline'`,
          `img-src 'self' data: blob:`,
          `media-src 'self' data: blob:`,
          `font-src 'self' data:`,
          `connect-src 'self' https: wss: http: ws: data: blob:`,
          `worker-src 'self' blob:`,
          `object-src 'none'`,
          `frame-src 'none'`,
          `base-uri 'self'`,
          `form-action 'none'`,
        ].join('; ');
        return html.replace('<meta charset="utf-8" />',
          `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), contentSecurityPolicy()],
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
