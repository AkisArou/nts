/*---
description: Implicit getters expose one mutable identity when spreading a local accessor object.
features: [ts-lifetime-scalar, ts-route-hook, ts-functions, ts-iteration, ts-objects, ts-accessors, ts-closures, ts-spread]
---*/
// Fact: field-only objects become locals (docs/foundations/memory.md, "Where nts stands").
// Route: spread invokes both getters after field-only uses; Node retains one identity shared by both results.
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
function prepare(n: number): { first: Point; second: Point } {
  const point = { x: n, y: n + 11 };
  point.y += point.x;
  const source = { get first(): Point { return point; }, get second(): Point { return point; } };
  return { ...source };
}
for (let n = 0; n < 240; n++) {
  const saved = prepare(n);
  for (let j = 1; j <= 16; j++) assert.sameValue(prepare(n + j).first.y, 2 * (n + j) + 11);
  check(saved.first, saved.second, n);
}
