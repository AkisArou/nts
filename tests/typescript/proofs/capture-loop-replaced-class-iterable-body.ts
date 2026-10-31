/*---
description: A replacement function writes the binding held by a closure during class iteration.
features: [ts-proof-capture, ts-route-loop, ts-functions, ts-function-types, ts-iteration, ts-class, ts-class-fields, ts-interfaces, ts-symbols, ts-objects, ts-closures]
---*/
// Fact: a read closure initially captures an unwritten binding (docs/foundations/objects.md, Functions as values).
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
  let value = 10;
  const read = (): number => value;
  let action: (step: number) => void = () => {};
  const write = (step: number): void => { value = 100 + step; };
  for (const step of new Turns(turns)) {
    action(step);
    action = write;
  }
  return read();
}
for (const n of [0, 1, 2, 3, 5]) {
  assert.sameValue(observe(n), n < 2 ? 10 : 99 + n);
}
