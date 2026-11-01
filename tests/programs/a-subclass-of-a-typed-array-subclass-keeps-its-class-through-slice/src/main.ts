// A subclass of a typed-array subclass is its own species through `slice`.
class Bytes extends Uint8Array {}
class Octets extends Bytes {}
export function probe(n: number): number {
  const copied = new Octets((n & 3) + 4).slice(1);
  return (copied instanceof Octets ? 1 : 0) + (copied instanceof Bytes ? 2 : 0) + copied.length * 10;
}
