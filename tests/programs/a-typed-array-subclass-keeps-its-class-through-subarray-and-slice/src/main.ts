// `subarray` and `slice` make their result with the receiver's species: a
// `Bytes` makes a `Bytes`, which still shares (subarray) or copies (slice)
// the bytes. Main made a plain view and lost the class.
class Bytes extends Uint8Array {}
export function probe(n: number): number {
  const bytes = new Bytes((n & 3) + 4);
  bytes[1] = 5;
  const shared = bytes.subarray(1);
  const copied = bytes.slice(1);
  bytes[1] = 9;
  return (shared instanceof Bytes ? 1 : 0) + (copied instanceof Bytes ? 2 : 0)
    + shared[0]! * 10 + copied[0]! * 100;
}
