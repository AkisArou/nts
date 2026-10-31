/*---
description: An exception payload exposes shared mutable identity after local field-only uses.
features: [ts-lifetime-scalar, ts-route-throw, ts-functions, ts-iteration, ts-objects, ts-errors, ts-class, ts-class-fields, ts-narrowing]
---*/
// Fact: field-only objects become locals (docs/foundations/memory.md, "Where nts stands").
// Route: throw carries both aliases through unwinding; Node shares writes between the caught payload fields.
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
class Packet {
  first: Point; second: Point;
  constructor(point: Point) { this.first = point; this.second = point; }
}
function raise(n: number): never {
  const point = { x: n, y: n + 11 };
  point.y += point.x;
  throw new Packet(point);
}
function prepare(n: number): Packet {
  try { raise(n); }
  catch (error) { if (error instanceof Packet) return error; throw error; }
}
for (let n = 0; n < 240; n++) {
  const saved = prepare(n);
  for (let j = 1; j <= 16; j++) assert.sameValue(prepare(n + j).first.y, 2 * (n + j) + 11);
  check(saved.first, saved.second, n);
}
