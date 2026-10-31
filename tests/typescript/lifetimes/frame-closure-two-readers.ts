/*---
description: Two delayed closures preserve one locally constructed object.
features: [ts-lifetime-frame, ts-route-closure, ts-functions, ts-iteration, ts-closures, ts-objects]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: stored readers outlive the call; node keeps both fields and one shared identity.
type Point = { x: number; y: number };
function prepare(n: number): { read: () => Point; again: () => Point } {
  const point = { x: n, y: n + 7 };
  point.y += point.x;
  return { read: () => point, again: () => point };
}
for (let n = 0; n < 240; n++) {
  const kept = prepare(n);
  for (let j = 1; j <= 12; j++) {
    const busy = prepare(n + j + 1000);
    assert.sameValue(busy.read().y, 2 * (n + j + 1000) + 7);
  }
  const point = kept.read();
  assert.sameValue(point === kept.again(), true);
  assert.sameValue(point.x, n);
  assert.sameValue(point.y, 2 * n + 7);
}
