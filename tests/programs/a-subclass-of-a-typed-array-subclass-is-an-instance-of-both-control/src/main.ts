// Control for a-subclass-of-a-typed-array-subclass-is-an-instance-of-both:
// the same tests of plain `Uint8Array`s, which are neither class.
class Bytes extends Uint8Array {}
class Octets extends Bytes {}
export function probe(n: number): number {
  const octets = new Uint8Array((n & 3) + 1);
  const bytes = new Uint8Array((n & 3) + 1);
  return (octets instanceof Octets ? 1 : 0) + (octets instanceof Bytes ? 2 : 0)
    + (octets instanceof Uint8Array ? 4 : 0) + (bytes instanceof Octets ? 8 : 0);
}
