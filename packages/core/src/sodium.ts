let sodiumPromise: Promise<any> | null = null;

export async function getSodium(): Promise<any> {
  if (!sodiumPromise) {
    sodiumPromise = import('libsodium-wrappers-sumo');
  }
  const mod = await sodiumPromise;
  // Node.js ESM: import() returns module namespace with .default
  // Browsers/Vite: import() resolves to default directly
  const sodium = mod.default || mod;
  await sodium.ready;
  return sodium;
}
