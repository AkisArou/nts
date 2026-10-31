/*---
description: A map callback retains an object made inside the calling function.
features: [ts-lifetime-frame, ts-route-callback, ts-functions, ts-iteration, ts-closures, ts-objects, ts-arrays]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: a builtin callback publishes the local; node preserves its fields and identity after return.
type Point = { x: number; y: number };
function prepare(n: number, out: Point[]): number {
  const point = { x: n, y: n + 47 };
  point.y += n;
  const totals = [1, 2].map(value => { out.push(point); return point.y + value; });
  return totals[0] + totals[1];
}
for (let n = 0; n < 240; n++) {
  const kept: Point[] = [];
  assert.sameValue(prepare(n, kept), 4 * n + 97);
  for (let j = 1; j <= 12; j++) assert.sameValue(prepare(n + j + 1000, []), 4 * (n + j + 1000) + 97);
  assert.sameValue(kept.length, 2);
  assert.sameValue(kept[0] === kept[1], true);
  assert.sameValue(kept[0].x, n);
  assert.sameValue(kept[0].y, 2 * n + 47);
}
