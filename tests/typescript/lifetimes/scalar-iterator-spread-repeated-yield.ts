/*---
description: Spreading two iterator results exposes their common mutable identity.
features: [ts-lifetime-scalar, ts-route-iterator, ts-functions, ts-iteration, ts-objects, ts-generators, ts-spread, ts-arrays]
---*/
// Fact: field-only objects become locals (docs/foundations/memory.md, "Where nts stands").
// Route: iterator spread retains the same yielded object twice; Node shares later writes after the generator ends.
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
function* points(n: number): Generator<Point, void, unknown> {
  const point = { x: n, y: n + 11 };
  point.y += point.x;
  yield point;
  yield point;
}
for (let n = 0; n < 240; n++) {
  const saved = [...points(n)];
  for (let j = 1; j <= 16; j++) {
    const busy = [...points(n + j)];
    assert.sameValue(busy[0].y, 2 * (n + j) + 11);
  }
  assert.sameValue(saved.length, 2);
  check(saved[0], saved[1], n);
}
