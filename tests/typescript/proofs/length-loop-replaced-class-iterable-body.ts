/*---
description: A replacement function shortens the allocation during class iteration.
features: [ts-proof-length, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-class, ts-class-fields, ts-interfaces, ts-symbols, ts-objects, ts-arrays, ts-closures]
---*/
// Fact: the literal allocation proves its length (docs/foundations/objects.md, Arrays).
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
  const xs = [1, 2, 3, 4, 5, 6, 7, 8];
  let action: () => void = () => { xs[0] += 1; };
  const shorten = (): void => { xs.length -= 1; };
  for (const step of new Turns(turns)) {
    action();
    action = shorten;
  }
  return xs.length;
}
for (const n of [0, 1, 2, 3, 5]) {
  assert.sameValue(observe(n), n < 2 ? 8 : 9 - n);
}
