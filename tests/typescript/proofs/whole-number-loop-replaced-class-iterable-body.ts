/*---
description: Class iteration carries a replacement function that crosses the signed integer boundary.
features: [ts-proof-whole-number, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-class, ts-class-fields, ts-interfaces, ts-symbols, ts-objects, ts-closures, ts-numbers]
---*/
// Fact: the initial literal is a whole finite integer (docs/foundations/numbers.md, Integers proved from doubles).
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
  let value = 2147483647;
  let action: () => void = () => { value |= 0; };
  const widen = (): void => { value += 2; };
  for (const step of new Turns(turns)) {
    action();
    action = widen;
  }
  return value;
}
for (const n of [0, 1, 2, 3, 5]) {
  assert.sameValue(observe(n), n < 2 ? 2147483647 : 2147483647 + 2 * (n - 1));
}
