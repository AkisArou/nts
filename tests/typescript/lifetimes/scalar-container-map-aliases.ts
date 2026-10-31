/*---
description: Map entries expose shared mutable identity after a local object initial field-only uses.
features: [ts-lifetime-scalar, ts-route-container, ts-functions, ts-iteration, ts-objects, ts-map-set]
---*/
// Fact: field-only objects become locals (docs/foundations/memory.md, "Where nts stands").
// Route: two map keys keep one object; Node observes field writes through a different map lookup.
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
function prepare(n: number, saved: Map<string, Point>): number {
  const point = { x: n, y: n + 11 };
  point.y += point.x;
  saved.set("first", point);
  saved.set("second", point);
  return point.x + point.y;
}
for (let n = 0; n < 240; n++) {
  const saved = new Map<string, Point>();
  assert.sameValue(prepare(n, saved), 3 * n + 11);
  const busy = new Map<string, Point>();
  for (let j = 1; j <= 16; j++) assert.sameValue(prepare(n + j, busy), 3 * (n + j) + 11);
  const first = saved.get("first"), second = saved.get("second");
  if (first === undefined || second === undefined) throw new Error("missing map entry");
  assert.sameValue(saved.size, 2);
  check(first, second, n);
}
