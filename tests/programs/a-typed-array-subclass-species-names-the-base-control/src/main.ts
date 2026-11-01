// Control for a-typed-array-subclass-species-names-the-base: the same subclass
// without a `[Symbol.species]` getter, so its species is itself and `subarray`
// and `slice` make a `Bytes`. The getter is the one difference, and it is what
// the subject's results are wrong about.
class Bytes extends Uint8Array {}
export function probe(n: number): number {
  const bytes = new Bytes((n & 3) + 4);
  const shared = bytes.subarray(1);
  const copied = bytes.slice(1);
  return (shared instanceof Bytes ? 1 : 0) + (copied instanceof Bytes ? 2 : 0)
    + (shared instanceof Uint8Array ? 4 : 0) + (bytes instanceof Bytes ? 8 : 0);
}
