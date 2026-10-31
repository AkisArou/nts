/*---
description: A finalizer exposes one mutable object rather than copies of scalar locals.
features: [ts-lifetime-scalar, ts-route-throw, ts-functions, ts-iteration, ts-objects, ts-errors, ts-arrays]
---*/
// Fact: field-only objects become locals (docs/foundations/memory.md, "Where nts stands").
// Route: finally retains two aliases during unwinding; Node observes later field writes through both.
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
function leave(n: number, saved: Point[]): never {
  const point = { x: n, y: n + 11 };
  point.y += point.x;
  try { throw new Error("leave"); }
  finally { saved.push(point, point); }
}
for (let n = 0; n < 240; n++) {
  const saved: Point[] = [];
  assert.throws(Error, () => leave(n, saved));
  for (let j = 1; j <= 16; j++) {
    const busy: Point[] = [];
    assert.throws(Error, () => leave(n + j, busy));
    assert.sameValue(busy[0].y, 2 * (n + j) + 11);
  }
  assert.sameValue(saved.length, 2);
  check(saved[0], saved[1], n);
}
