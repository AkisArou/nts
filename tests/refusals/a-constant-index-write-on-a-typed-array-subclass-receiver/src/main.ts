// expect: NTS1001 assigning to this property is not supported by this lowering yet
//
// A write through a constant index on `this` in a typed-array subclass is
// refused as a property assignment, while the same write through an index the
// caller passes compiles and agrees with node: see
// tests/programs/a-computed-index-write-on-a-typed-array-subclass-receiver.
class Bytes extends Uint8Array {
  mark(_at: number): this {
    this[0] = 7;
    return this;
  }
}
export function probe(n: number): number {
  const bytes = new Bytes((n & 3) + 1).mark(0);
  return bytes.length * 10 + bytes[0]!;
}
