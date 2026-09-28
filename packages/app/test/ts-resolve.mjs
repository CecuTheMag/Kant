/**
 * Node resolve hook for the app's unit tests. App sources import siblings
 * without an extension (the bundler convention Vite uses); Node's native
 * TypeScript support needs the real file name, so try `.ts` / `.tsx`.
 */
const RELATIVE = /^\.{1,2}\//;
const HAS_EXT = /\.[cm]?[jt]sx?$/;

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!RELATIVE.test(specifier) || HAS_EXT.test(specifier)) throw error;
    for (const ext of ['.ts', '.tsx']) {
      try { return await nextResolve(specifier + ext, context); } catch { /* try next */ }
    }
    throw error;
  }
}
