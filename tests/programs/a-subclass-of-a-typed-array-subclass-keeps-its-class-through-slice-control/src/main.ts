// Control for a-subclass-of-a-typed-array-subclass-keeps-its-class-through-
// slice: a plain `Uint8Array` receiver, whose species is `Uint8Array`.
class Bytes extends Uint8Array {}
class Octets extends Bytes {}
export function probe(n: number): number {
  const copied = new Uint8Array((n & 3) + 4).slice(1);
  return (copied instanceof Octets ? 1 : 0) + (copied instanceof Bytes ? 2 : 0) + copied.length * 10;
}
