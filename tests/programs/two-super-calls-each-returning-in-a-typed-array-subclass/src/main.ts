// Control for tests/refusals/two-super-calls-whose-paths-rejoin-in-a-typed-array-subclass: each arm returns after its `super(...)`, so no two instances rejoin.
class Bytes extends Uint8Array {
  constructor(size: number, wide: boolean) {
    if (wide) {
      super(size * 2);
      this.fill(1);
      return;
    }
    super(size);
    this.fill(1);
  }
}
export function probe(n: number): number {
  const bytes = new Bytes((n & 3) + 1, (n & 4) !== 0);
  return bytes.length * 10 + bytes[0]!;
}
