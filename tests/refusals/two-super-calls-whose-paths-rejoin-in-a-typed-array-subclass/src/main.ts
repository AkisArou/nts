// expect: NTS1001 two `super(...)` calls on paths that rejoin, each making its own instance is not supported by this lowering yet
//
// Each arm of the `if` makes the view with its own `super(...)` and the paths
// rejoin, so `this` after it is one of two instances; refused by name.
// Control: tests/programs/two-super-calls-each-returning-in-a-typed-array-subclass.
class Bytes extends Uint8Array {
  constructor(size: number, wide: boolean) {
    if (wide) {
      super(size * 2);
    } else {
      super(size);
    }
    this.fill(1);
  }
}
export function probe(n: number): number {
  const bytes = new Bytes((n & 3) + 1, (n & 4) !== 0);
  return bytes.length * 10 + bytes[0]!;
}
