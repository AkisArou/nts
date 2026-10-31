/*---
description: A program callback exposes shared mutable identity after local field-only work.
features: [ts-lifetime-scalar, ts-route-callback, ts-functions, ts-iteration, ts-objects, ts-closures, ts-arrays, ts-function-types]
---*/
// Fact: field-only objects become locals (docs/foundations/memory.md, "Where nts stands").
// Route: the supplied callback retains both arguments; Node shares later field writes through the saved references.
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
function prepare(n: number, save: (point: Point) => void): number {
  const point = { x: n, y: n + 11 };
  point.y += point.x;
  save(point);
  save(point);
  return point.x + point.y;
}
for (let n = 0; n < 240; n++) {
  const saved: Point[] = [];
  assert.sameValue(prepare(n, point => saved.push(point)), 3 * n + 11);
  for (let j = 1; j <= 16; j++) {
    const busy: Point[] = [];
    assert.sameValue(prepare(n + j, point => busy.push(point)), 3 * (n + j) + 11);
    assert.sameValue(busy[0] === busy[1], true);
  }
  assert.sameValue(saved.length, 2);
  check(saved[0], saved[1], n);
}
