/**
 * Bundle the Electron main process into a single file.
 *
 * electron-builder copies only the app's direct dependencies out of pnpm's
 * symlinked node_modules, not their own dependencies, so the packaged app
 * crashed at start with "Cannot find module '@hono/node-server'" (a dependency
 * of @modelcontextprotocol/sdk). Inlining every npm dependency here makes the
 * package independent of the install layout. `tsc` still runs first for type
 * checking and emits preload.js, which must stay a plain file: it runs in the
 * sandboxed renderer and only imports `electron`.
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist-electron/main.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // Electron 33 ships Node 20.
  target: 'node20',
  external: ['electron'],
  // Keep the bundled dependencies' licence notices next to the bundle.
  legalComments: 'external',
  logLevel: 'warning',
});
