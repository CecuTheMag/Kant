let sodiumPromise: Promise<any> | null = null;

export async function getSodium(): Promise<any> {
  if (!sodiumPromise) {
    sodiumPromise = import('libsodium-wrappers-sumo');
  }
  const sodium = await sodiumPromise;
  await sodium.ready;
  return sodium;
}
