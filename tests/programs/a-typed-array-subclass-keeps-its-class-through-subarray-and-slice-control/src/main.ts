// Control for a-typed-array-subclass-keeps-its-class-through-subarray-and-
// slice: a plain `Uint8Array` receiver, whose species is `Uint8Array`.
class Bytes extends Uint8Array {}
export function probe(n: number): number {
  const bytes = new Uint8Array((n & 3) + 4);
  bytes[1] = 5;
  const shared = bytes.subarray(1);
  const copied = bytes.slice(1);
  bytes[1] = 9;
  return (shared instanceof Bytes ? 1 : 0) + (copied instanceof Bytes ? 2 : 0)
    + shared[0]! * 10 + copied[0]! * 100;
}
