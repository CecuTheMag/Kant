import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Resolve libsodium-wrappers relative to this package, not an absolute path.
let SODIUM_URL;
try {
  const resolved = require.resolve('libsodium-wrappers');
  SODIUM_URL = `file://${resolved}`;
} catch {
  // Fallback: walk up to workspace root and try pnpm layout
  const fallback = join(__dirname, '../../node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js');
  SODIUM_URL = `file://${fallback}`;
}

export function resolve(specifier, context, next) {
  if (specifier.includes('libsodium-wrappers') && !specifier.includes('sumo')) {
    return { url: SODIUM_URL, shortCircuit: true };
  }
  return next(specifier, context);
}
