/*---
description: Reentrant callbacks mutate the object later read through its original field accesses.
features: [ts-lifetime-scalar, ts-route-re-entry, ts-functions, ts-iteration, ts-objects, ts-closures, ts-function-types]
---*/
// Fact: field-only objects become locals (docs/foundations/memory.md, "Where nts stands").
// Route: a callback re-enters the same producer and returns an alias; Node observes all nested writes in the outer frame.
type Point = { x: number; y: number };
function visit(n: number, changes: number, callback: (point: Point) => Point): number {
  const point = { x: n, y: n + 11 };
  point.y += point.x;
  const witness = callback(point);
  assert.sameValue(point === witness, true);
  assert.sameValue(point.x, n + changes);
  assert.sameValue(point.y, 2 * n + 11 - 2 * changes);
  return point.x + point.y;
}
for (let n = 0; n < 240; n++) {
  const sum = visit(n, 16, outer => {
    for (let j = 1; j <= 16; j++) {
      assert.sameValue(visit(n + j + 1000, 0, inner => {
        assert.sameValue(inner === outer, false);
        outer.x += 1;
        outer.y -= 2;
        return inner;
      }), 3 * (n + j + 1000) + 11);
    }
    assert.sameValue(outer.x, n + 16);
    assert.sameValue(outer.y, 2 * n - 21);
    return outer;
  });
  assert.sameValue(sum, 3 * n - 5);
}
