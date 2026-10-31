/*---
description: Reading a getter publishes a local object that must survive the producer.
features: [ts-lifetime-frame, ts-route-hook, ts-functions, ts-iteration, ts-accessors, ts-closures, ts-objects, ts-arrays]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: an implicit getter call stores the local; node keeps both fields and shared identity.
type Point = { x: number; y: number };
function prepare(n: number, out: Point[]): number {
  const point = { x: n, y: n + 41 };
  point.y += n;
  const hook = { get value(): number { out.push(point, point); return point.y; } };
  return hook.value;
}
for (let n = 0; n < 240; n++) {
  const kept: Point[] = [];
  assert.sameValue(prepare(n, kept), 2 * n + 41);
  for (let j = 1; j <= 12; j++) {
    const busy: Point[] = [];
    assert.sameValue(prepare(n + j + 1000, busy), 2 * (n + j + 1000) + 41);
  }
  assert.sameValue(kept.length, 2);
  assert.sameValue(kept[0] === kept[1], true);
  assert.sameValue(kept[0].x, n);
  assert.sameValue(kept[0].y, 2 * n + 41);
}
