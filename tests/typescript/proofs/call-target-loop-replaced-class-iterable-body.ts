/*---
description: A for-of over a class iterator dispatches the function installed by the preceding iteration.
features: [ts-proof-call-target, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-class, ts-class-fields, ts-interfaces, ts-symbols, ts-objects]
---*/
// Fact: the initial function value has one known implementation (docs/foundations/objects.md, Calls).
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

function first(value: number): number { return 100 + value; }
function second(value: number): number { return 200 + 3 * value; }
function observe(turns: number): number {
  let action: (value: number) => number = first;
  let result = 100 + turns;
  for (const step of new Turns(turns)) {
    result = action(step + turns);
    action = second;
  }
  return result;
}
for (const n of [0, 1, 2, 3, 5]) {
  assert.sameValue(observe(n), n < 2 ? 100 + n : 200 + 3 * (2 * n - 1));
}
