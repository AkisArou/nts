// Source control for builtin-study-web-crypto-subtle. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
function sourceDigest(_algorithm: string, value: Uint8Array): Promise<ArrayBuffer> { return Promise.resolve(new ArrayBuffer(value.length + 31)); }

export async function webCryptoSubtleControl(): Promise<number> {
  const result = await sourceDigest("SHA-256", new Uint8Array(1)); return result.byteLength;
}
