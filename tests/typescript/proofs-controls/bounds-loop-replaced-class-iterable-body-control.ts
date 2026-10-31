/*---
description: Control. Remove only the replacement of action; the array remains unchanged.
features: [ts-proof-bounds, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-class, ts-class-fields, ts-interfaces, ts-symbols, ts-objects, ts-arrays, ts-closures]
---*/
// Control: paired with proofs/bounds-loop-replaced-class-iterable-body.ts. Remove only the replacement of action; the array remains unchanged.
// Fact: an allocation proves the index in range (docs/foundations/objects.md, Arrays).
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

function observe(turns: number): number {
  const xs = [10, 20, 30, 40];
  const index = 1;
  let action: (step: number) => void = () => {};
  const move = (step: number): void => { xs.unshift(100 + step); };
  for (const step of new Turns(turns)) {
    action(step);
  }
  return xs[index];
}
for (const n of [0, 1, 2, 3, 5]) {
  assert.sameValue(observe(n), 20);
}
