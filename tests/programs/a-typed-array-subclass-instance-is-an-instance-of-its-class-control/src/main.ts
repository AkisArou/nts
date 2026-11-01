// Control for a-typed-array-subclass-instance-is-an-instance-of-its-class:
// the same tests of a plain `Uint8Array`, which is not a `Bytes`.
class Bytes extends Uint8Array {}
export function probe(n: number): number {
  const bytes = new Uint8Array((n & 3) + 1);
  return (bytes instanceof Bytes ? 1 : 0) + (bytes instanceof Uint8Array ? 2 : 0);
}
