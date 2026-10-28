// Source control for builtin-study-web-crypto-random. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
function sourceFill(value: Uint8Array): Uint8Array { for (let i = 0; i < value.length; i++) value[i] = i; return value; }

export function webCryptoRandomControl(): string {
  const u = new Uint8Array(4); sourceFill(u); return u[0] + ":" + u[1] + ":" + u[2] + ":" + u[3];
}
