// Control for a-typed-array-subclass-tested-through-a-union: the same union,
// whose both arms make a plain `Uint8Array`.
class Bytes extends Uint8Array {}
function pick(n: number): Uint8Array | Bytes {
  return (n & 1) === 0 ? new Uint8Array((n & 3) + 1) : new Uint8Array((n & 3) + 1);
}
export function probe(n: number): number {
  const value = pick(n | 0);
  return (value instanceof Bytes ? 1 : 0) + (value instanceof Uint8Array ? 2 : 0);
}
