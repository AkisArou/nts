/*---
description: Reentrant calls preserve the distinct frame objects of all active calls.
features: [ts-lifetime-frame, ts-route-re-entry, ts-functions, ts-iteration, ts-closures, ts-function-types, ts-objects]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: a callback re-enters before the outer read; node preserves each active object and its fields.
type Point = { x: number; y: number };
function visit(n: number, callback: (point: Point) => void): number {
  const point = { x: n, y: n + 53 };
  const witness = { point };
  point.y += n;
  callback(point);
  assert.sameValue(point === witness.point, true);
  assert.sameValue(point.x, n);
  assert.sameValue(point.y, 2 * n + 53);
  return point.x + point.y;
}
for (let n = 0; n < 240; n++) {
  const total = visit(n, outer => {
    for (let j = 1; j <= 12; j++) {
      assert.sameValue(visit(n + j + 1000, inner => {
        assert.sameValue(inner === outer, false);
        assert.sameValue(inner.x, n + j + 1000);
        assert.sameValue(inner.y, 2 * (n + j + 1000) + 53);
      }), 3 * (n + j + 1000) + 53);
    }
    assert.sameValue(outer.x, n);
    assert.sameValue(outer.y, 2 * n + 53);
  });
  assert.sameValue(total, 3 * n + 53);
}
