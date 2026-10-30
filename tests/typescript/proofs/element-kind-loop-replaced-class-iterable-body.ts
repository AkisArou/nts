/*---
description: A function replaced in class iteration stores NaN after an integer-only first store.
features: [ts-proof-element-kind, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-class, ts-class-fields, ts-interfaces, ts-symbols, ts-objects, ts-arrays, ts-closures, ts-numbers]
---*/
// Fact: the initial number arrays hold only small integers (docs/foundations/objects.md, Arrays).
// Route: a for-of back edge over the class iterator carries the replacement to the next function-value call.
class Turns implements IterableIterator<number, undefined, unknown> {
  index: number = 0;
  limit: number;
  constructor(limit: number) { this.limit = limit; }
  [Symbol.iterator](): IterableIterator<number, undefined, unknown> { return this; }
  next(): IteratorResult<number, undefined> {
    return this.index < this.limit
      ? { done: false, value: this.index++ }
      : { done: true, value: undefined };
  }
}

function readFirst(xs: number[]): number { return xs[0]; }
function observe(turns: number): number {
  const xs = [7];
  let action: () => void = () => { xs[0] %= 2; };
  const invalidate = (): void => { xs[0] %= 0; };
  for (const step of new Turns(turns)) {
    action();
    action = invalidate;
  }
  return readFirst(xs);
}
for (const n of [0, 1, 2, 3, 5]) {
  assert.sameValue(observe(n), n === 0 ? 7 : n === 1 ? 1 : NaN);
}
