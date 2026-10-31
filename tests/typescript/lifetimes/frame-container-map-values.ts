/*---
description: Two map entries preserve one object after the constructing call has ended.
features: [ts-lifetime-frame, ts-route-container, ts-functions, ts-iteration, ts-map-set, ts-objects]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: map stores retain the object; node preserves both numeric fields and entry identity.
type Point = { x: number; y: number };
function fill(n: number, out: Map<string, Point>): void {
  const point = { x: n, y: n + 11 };
  point.y += n;
  out.set("first", point);
  out.set("second", point);
}
for (let n = 0; n < 240; n++) {
  const kept = new Map<string, Point>();
  fill(n, kept);
  const busy = new Map<string, Point>();
  for (let j = 1; j <= 12; j++) {
    fill(n + j + 1000, busy);
    const value = busy.get("first");
    if (value === undefined) throw new Test262Error("missing churn value");
    assert.sameValue(value.y, 2 * (n + j + 1000) + 11);
  }
  const first = kept.get("first");
  const second = kept.get("second");
  if (first === undefined || second === undefined) throw new Test262Error("missing value");
  assert.sameValue(first === second, true);
  assert.sameValue(first.x, n);
  assert.sameValue(first.y, 2 * n + 11);
}
