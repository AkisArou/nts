/*---
description: Two map callback results expose one mutable object instead of two scalar copies.
features: [ts-lifetime-scalar, ts-route-callback, ts-functions, ts-iteration, ts-objects, ts-closures, ts-arrays]
---*/
// Fact: field-only objects become locals (docs/foundations/memory.md, "Where nts stands").
// Route: map stores the captured object twice; Node preserves its identity and shares subsequent field writes.
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
function prepare(n: number): Point[] {
  const point = { x: n, y: n + 11 };
  point.y += point.x;
  return [0, 1].map(() => point);
}
for (let n = 0; n < 240; n++) {
  const saved = prepare(n);
  for (let j = 1; j <= 16; j++) assert.sameValue(prepare(n + j)[0].y, 2 * (n + j) + 11);
  assert.sameValue(saved.length, 2);
  check(saved[0], saved[1], n);
}
