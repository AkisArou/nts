/*---
description: A sort comparator retains its callers local object after sorting finishes.
features: [ts-lifetime-frame, ts-route-hook, ts-functions, ts-iteration, ts-closures, ts-objects, ts-arrays]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: sort invokes the capturing comparator; node keeps the original object after later sorts.
type Point = { x: number; y: number };
function prepare(n: number, out: Point[]): number {
  const point = { x: n, y: n + 43 };
  point.y += n;
  const values = [3, 1, 2];
  values.sort((a, b) => {
    if (out.length === 0) out.push(point, point);
    return a - b;
  });
  return values[0] + values[1] + values[2];
}
for (let n = 0; n < 240; n++) {
  const kept: Point[] = [];
  assert.sameValue(prepare(n, kept), 6);
  for (let j = 1; j <= 12; j++) assert.sameValue(prepare(n + j + 1000, []), 6);
  assert.sameValue(kept.length, 2);
  assert.sameValue(kept[0] === kept[1], true);
  assert.sameValue(kept[0].x, n);
  assert.sameValue(kept[0].y, 2 * n + 43);
}
