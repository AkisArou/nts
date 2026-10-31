/*---
description: Sibling closures observe one object after it becomes observable beyond its initial field uses.
features: [ts-lifetime-scalar, ts-route-closure, ts-functions, ts-iteration, ts-objects, ts-closures]
---*/
// Fact: field-only objects become locals (docs/foundations/memory.md, "Where nts stands").
// Route: stored readers and a writer expose shared identity; Node observes every later mutation through both readers.
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
function prepare(n: number): { first: () => Point; second: () => Point; bump: () => void } {
  const point = { x: n, y: n + 11 };
  point.y += point.x;
  return {
    first: () => point,
    second: () => point,
    bump: () => { point.x += 3; point.y += 5; }
  };
}
for (let n = 0; n < 240; n++) {
  const kept = prepare(n);
  for (let j = 1; j <= 16; j++) assert.sameValue(prepare(n + j).first().x, n + j);
  check(kept.first(), kept.second(), n);
  kept.bump();
  assert.sameValue(kept.first().x, n + 104);
  assert.sameValue(kept.second().y, 2 * n - 21);
}
