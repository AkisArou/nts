/*---
description: Two array entries expose one local object identity and shared field updates.
features: [ts-lifetime-scalar, ts-route-container, ts-functions, ts-iteration, ts-objects, ts-arrays]
---*/
// Fact: field-only objects become locals (docs/foundations/memory.md, "Where nts stands").
// Route: array stores expose the field-only local; Node shares mutations between its two retained entries.
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
function prepare(n: number, saved: Point[]): number {
  const point = { x: n, y: n + 11 };
  point.y += point.x;
  saved.push(point, point);
  return point.x + point.y;
}
for (let n = 0; n < 240; n++) {
  const saved: Point[] = [];
  assert.sameValue(prepare(n, saved), 3 * n + 11);
  for (let j = 1; j <= 16; j++) assert.sameValue(prepare(n + j, []), 3 * (n + j) + 11);
  assert.sameValue(saved.length, 2);
  check(saved[0], saved[1], n);
  assert.sameValue(saved[0].y, 2 * n - 26);
  assert.sameValue(saved[1].x, n + 101);
}
