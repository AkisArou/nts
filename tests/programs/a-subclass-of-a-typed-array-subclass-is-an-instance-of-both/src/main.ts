// A class extending a typed-array subclass is an instance of both, and its
// base is not an instance of it.
class Bytes extends Uint8Array {}
class Octets extends Bytes {}
export function probe(n: number): number {
  const octets = new Octets((n & 3) + 1);
  const bytes = new Bytes((n & 3) + 1);
  return (octets instanceof Octets ? 1 : 0) + (octets instanceof Bytes ? 2 : 0)
    + (octets instanceof Uint8Array ? 4 : 0) + (bytes instanceof Octets ? 8 : 0);
}
