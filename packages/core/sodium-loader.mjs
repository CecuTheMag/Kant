const SODIUM_CJS = 'file:///home/magcecu/Documents/GitHub/Kant/node_modules/.pnpm/libsodium-wrappers@0.7.16/node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js';

export function resolve(specifier, context, next) {
  if (specifier.includes('libsodium-wrappers')) {
    return { url: SODIUM_CJS, shortCircuit: true };
  }
  return next(specifier, context);
}
