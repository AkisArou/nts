/*---
description: Sets retain the same object after its constructing function returns.
features: [ts-lifetime-frame, ts-route-container, ts-functions, ts-iteration, ts-map-set, ts-objects]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: two set memberships retain the object; node preserves its contents and shared identity.
type Point = { x: number; y: number };
function insert(n: number, first: Set<Point>, second: Set<Point>): void {
  const point = { x: n, y: n + 13 };
  point.y += n;
  first.add(point);
  second.add(point);
}
for (let n = 0; n < 240; n++) {
  const first = new Set<Point>();
  const second = new Set<Point>();
  insert(n, first, second);
  for (let j = 1; j <= 12; j++) {
    const busy = new Set<Point>();
    insert(n + j + 1000, busy, busy);
    for (const point of busy) assert.sameValue(point.y, 2 * (n + j + 1000) + 13);
  }
  const a = first.values().next().value;
  const b = second.values().next().value;
  if (a === undefined || b === undefined) throw new Test262Error("missing member");
  assert.sameValue(a === b, true);
  assert.sameValue(first.size, 1);
  assert.sameValue(second.size, 1);
  assert.sameValue(a.x, n);
  assert.sameValue(a.y, 2 * n + 13);
}
