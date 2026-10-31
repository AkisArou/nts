/*---
description: An iterator result retains an object allocated inside next after later next calls.
features: [ts-lifetime-frame, ts-route-iterator, ts-functions, ts-iteration, ts-objects, ts-class, ts-interfaces]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: next hands out a local object; node keeps its fields and both references in the result.
type Point = { x: number; y: number };
type Pair = { first: Point; second: Point };
class Cursor implements Iterator<Pair, undefined> {
  index: number;
  constructor(n: number) { this.index = n; }
  next(): IteratorResult<Pair, undefined> {
    const point = { x: this.index, y: this.index + 37 };
    point.y += point.x;
    this.index++;
    return { done: false, value: { first: point, second: point } };
  }
}
for (let n = 0; n < 240; n++) {
  const cursor = new Cursor(n);
  const kept = cursor.next();
  if (kept.done) throw new Test262Error("unexpected end");
  for (let j = 1; j <= 16; j++) {
    const busy = cursor.next();
    if (busy.done) throw new Test262Error("unexpected end");
    assert.sameValue(busy.value.first.y, 2 * (n + j) + 37);
  }
  assert.sameValue(kept.value.first === kept.value.second, true);
  assert.sameValue(kept.value.first.x, n);
  assert.sameValue(kept.value.first.y, 2 * n + 37);
}
