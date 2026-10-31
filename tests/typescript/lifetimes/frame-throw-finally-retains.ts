/*---
description: A finally block publishes a local object while the call unwinds.
features: [ts-lifetime-frame, ts-route-throw, ts-functions, ts-iteration, ts-errors, ts-objects, ts-arrays]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: finally retains the local before its frame ends; node keeps both fields and one identity.
type Point = { x: number; y: number };
function raise(n: number, out: Point[]): never {
  const point = { x: n, y: n + 23 };
  point.y += n;
  try { throw new Error("leave"); }
  finally { out.push(point, point); }
}
for (let n = 0; n < 240; n++) {
  const kept: Point[] = [];
  assert.throws(Error, () => raise(n, kept));
  for (let j = 1; j <= 12; j++) {
    const busy: Point[] = [];
    assert.throws(Error, () => raise(n + j + 1000, busy));
    assert.sameValue(busy[0].y, 2 * (n + j + 1000) + 23);
  }
  assert.sameValue(kept.length, 2);
  assert.sameValue(kept[0] === kept[1], true);
  assert.sameValue(kept[0].x, n);
  assert.sameValue(kept[0].y, 2 * n + 23);
}
