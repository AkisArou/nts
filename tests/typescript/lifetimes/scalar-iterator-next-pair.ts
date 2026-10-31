/*---
description: Iterator next results preserve shared identity after their producer used only fields.
features: [ts-lifetime-scalar, ts-route-iterator, ts-functions, ts-iteration, ts-objects, ts-class, ts-class-fields, ts-tuples]
---*/
// Fact: field-only objects become locals (docs/foundations/memory.md, "Where nts stands").
// Route: next hands out two aliases; Node shares writes after later next calls reuse the allocation site.
type Point = { x: number; y: number };
function check(first: Point, second: Point, n: number): void {
  assert.sameValue(first === second, true);
  assert.sameValue(first.x, n);
  assert.sameValue(first.y, 2 * n + 11);
  first.x += 101;
  assert.sameValue(second.x, n + 101);
  second.y -= 37;
  assert.sameValue(first.y, 2 * n - 26);
  assert.sameValue(first.x, n + 101);
  assert.sameValue(second.y, 2 * n - 26);
}
class Cursor implements Iterator<[Point, Point]> {
  index: number;
  constructor(n: number) { this.index = n; }
  next(): IteratorResult<[Point, Point]> {
    const point = { x: this.index, y: this.index + 11 };
    point.y += point.x;
    this.index++;
    return { done: false, value: [point, point] };
  }
}
for (let n = 0; n < 240; n++) {
  const cursor = new Cursor(n);
  const saved = cursor.next();
  if (saved.done) throw new Error("missing pair");
  for (let j = 1; j <= 16; j++) {
    const busy = cursor.next();
    if (busy.done) throw new Error("missing busy pair");
    assert.sameValue(busy.value[0].y, 2 * (n + j) + 11);
  }
  check(saved.value[0], saved.value[1], n);
}
