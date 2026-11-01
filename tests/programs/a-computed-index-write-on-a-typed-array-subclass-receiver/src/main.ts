// Control for tests/refusals/a-constant-index-write-on-a-typed-array-subclass-receiver:
// the same write through an index the caller passes.
class Bytes extends Uint8Array {
  mark(at: number): this {
    this[at] = 7;
    return this;
  }
}
export function probe(n: number): number {
  const bytes = new Bytes((n & 3) + 1).mark(0);
  return bytes.length * 10 + bytes[0]!;
}
