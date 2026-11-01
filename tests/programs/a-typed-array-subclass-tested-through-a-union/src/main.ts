// A value typed `Uint8Array | Bytes` is either, so `instanceof Bytes` is a
// run-time compare rather than a fold.
class Bytes extends Uint8Array {}
function pick(n: number): Uint8Array | Bytes {
  return (n & 1) === 0 ? new Bytes((n & 3) + 1) : new Uint8Array((n & 3) + 1);
}
export function probe(n: number): number {
  const value = pick(n | 0);
  return (value instanceof Bytes ? 1 : 0) + (value instanceof Uint8Array ? 2 : 0);
}
