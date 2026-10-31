/*---
description: An implicit sort comparator exposes one object whose earlier uses were all fields.
features: [ts-lifetime-scalar, ts-route-hook, ts-functions, ts-iteration, ts-objects, ts-closures, ts-arrays]
---*/
// Fact: field-only objects become locals (docs/foundations/memory.md, "Where nts stands").
// Route: the comparator retains two references; Node shares later field writes after sorting has finished.
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
  const values = [3, 1, 2];
  values.sort((a, b) => { if (saved.length === 0) saved.push(point, point); return a - b; });
  return values[0] + values[1] + values[2];
}
for (let n = 0; n < 240; n++) {
  const saved: Point[] = [];
  assert.sameValue(prepare(n, saved), 6);
  for (let j = 1; j <= 16; j++) assert.sameValue(prepare(n + j, []), 6);
  assert.sameValue(saved.length, 2);
  check(saved[0], saved[1], n);
}
