/*---
description: An outer array retains an object constructed by a completed call.
features: [ts-lifetime-frame, ts-route-container, ts-functions, ts-iteration, ts-arrays, ts-objects]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: array elements keep the local object; node sees its original fields and equal identities.
type Point = { x: number; y: number };
function append(n: number, out: Point[]): void {
  const point = { x: n, y: n + 5 };
  point.y += point.x;
  out.push(point, point);
}
for (let n = 0; n < 240; n++) {
  const kept: Point[] = [];
  append(n, kept);
  for (let j = 1; j <= 12; j++) {
    const busy: Point[] = [];
    append(n + j + 1000, busy);
    assert.sameValue(busy[0].y, 2 * (n + j + 1000) + 5);
  }
  assert.sameValue(kept.length, 2);
  assert.sameValue(kept[0] === kept[1], true);
  assert.sameValue(kept[0].x, n);
  assert.sameValue(kept[0].y, 2 * n + 5);
}
