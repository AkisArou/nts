/*---
description: Two callback arguments remain one object when nested calls mutate them by separate paths.
features: [ts-lifetime-scalar, ts-route-re-entry, ts-functions, ts-iteration, ts-objects, ts-closures, ts-function-types]
---*/
// Fact: field-only objects become locals (docs/foundations/memory.md, "Where nts stands").
// Route: re-entry churns the producer while aliases mutate the outer object; Node updates its original field reads.
type Point = { x: number; y: number };
function visit(n: number, changes: number, callback: (first: Point, second: Point) => void): void {
  const point = { x: n, y: n + 11 };
  point.y += point.x;
  callback(point, point);
  assert.sameValue(point.x, n + 3 * changes);
  assert.sameValue(point.y, 2 * n + 11 + 5 * changes);
}
for (let n = 0; n < 240; n++) {
  visit(n, 16, (first, second) => {
    assert.sameValue(first === second, true);
    for (let j = 1; j <= 16; j++) {
      visit(n + j + 1000, 0, (inner, witness) => {
        assert.sameValue(inner === witness, true);
        assert.sameValue(inner === first, false);
        assert.sameValue(inner.x, n + j + 1000);
        assert.sameValue(inner.y, 2 * (n + j + 1000) + 11);
      });
      first.x += 3;
      second.y += 5;
    }
    assert.sameValue(second.x, n + 48);
    assert.sameValue(first.y, 2 * n + 91);
  });
}
