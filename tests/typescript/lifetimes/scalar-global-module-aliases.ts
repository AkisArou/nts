/*---
description: Publishing a field-only local into module slots makes later shared writes observable.
features: [ts-lifetime-scalar, ts-route-global, ts-functions, ts-iteration, ts-objects, ts-modules]
flags: [module]
---*/
// Fact: field-only objects become locals (docs/foundations/memory.md, "Where nts stands").
// Route: two module slots keep one identity; Node sees a write through either slot through the other.
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
let kept: Point | null = null, witness: Point | null = null;
function prepare(n: number, publish: boolean): number {
  const point = { x: n, y: n + 11 };
  point.y += point.x;
  if (publish) { kept = point; witness = point; }
  return point.x + point.y;
}
function verify(n: number): void {
  if (kept === null || witness === null) throw new Error("missing publication");
  check(kept, witness, n);
  assert.sameValue(kept.x, n + 101);
  assert.sameValue(witness.y, 2 * n - 26);
}
for (let n = 0; n < 240; n++) {
  assert.sameValue(prepare(n, true), 3 * n + 11);
  for (let j = 1; j <= 16; j++) assert.sameValue(prepare(n + j, false), 3 * (n + j) + 11);
  verify(n);
  kept = null; witness = null;
}
