let sodiumPromise = null;
export async function getSodium() {
    if (!sodiumPromise) {
        sodiumPromise = import('libsodium-wrappers');
    }
    const sodium = await sodiumPromise;
    await sodium.ready;
    return sodium;
}
