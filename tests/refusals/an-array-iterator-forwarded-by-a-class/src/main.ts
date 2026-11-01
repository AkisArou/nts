// expect: NTS1001 a `[Symbol.iterator]()` whose result has no representation is not supported by this lowering yet
// ARES-6 Air: Code#hash walks Code, whose iterator forwards _blocks' array iterator.
// Origin: benchmarks/cases/ares6-air/core.ts on helper4/ares6-family at 5579ea43fcf8.
// The control changes only the iterator producer to a generator forwarding the
// same array in the same order. No benchmark workload is changed.
// Control: tests/programs/an-array-iterator-forwarded-by-a-class-control.
class Bucket {
  values: number[];
  constructor(n: number) { this.values = [n, n + 1, n + 2]; }
  [Symbol.iterator](): ArrayIterator<number> {
    return this.values[Symbol.iterator]();
  }
}
export function work(n: number): number {
  let total = 0;
  for (const value of new Bucket(n)) total += value;
  return total;
}
