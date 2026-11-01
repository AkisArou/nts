// ARES-6 Air forwarded-iterator control: only the iterator producer changes.
class Bucket {
  values: number[];
  constructor(n: number) { this.values = [n, n + 1, n + 2]; }
  *[Symbol.iterator](): Generator<number> {
    yield* this.values;
  }
}
export function work(n: number): number {
  let total = 0;
  for (const value of new Bucket(n)) total += value;
  return total;
}
