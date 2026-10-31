/*---
description: Repeated calls to a stored closure return one mutable identity rather than fresh scalar snapshots.
features: [ts-lifetime-scalar, ts-route-closure, ts-functions, ts-iteration, ts-objects, ts-closures, ts-function-types]
---*/
// Fact: field-only objects become locals (docs/foundations/memory.md, "Where nts stands").
// Route: a stored closure both mutates and returns its capture; Node shares each write with earlier returned aliases.
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
function prepare(n: number): (amount: number) => Point {
  const point = { x: n, y: n + 11 };
  point.y += point.x;
  return (amount: number): Point => { point.y += amount; return point; };
}
for (let n = 0; n < 240; n++) {
  const access = prepare(n);
  for (let j = 1; j <= 16; j++) assert.sameValue(prepare(n + j)(2).y, 2 * (n + j) + 13);
  const first = access(0), second = access(0);
  check(first, second, n);
  const third = access(19);
  assert.sameValue(third === first, true);
  assert.sameValue(second.x, n + 101);
  assert.sameValue(first.y, 2 * n - 7);
}
