/*---
description: A spread copy preserves a local child after the first owner field is cleared.
features: [ts-lifetime-frame, ts-route-alias, ts-functions, ts-iteration, ts-spread, ts-objects]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: a shallow spread creates an alias before the original is dropped; node keeps the child fields.
type Point = { x: number; y: number };
function prepare(n: number): { first: Point; second: Point } {
  const owner: { child: Point | null } = { child: { x: n, y: n + 59 } };
  const copy = { ...owner };
  owner.child = null;
  if (copy.child === null) throw new Test262Error("lost copied field");
  return { first: copy.child, second: copy.child };
}
for (let n = 0; n < 240; n++) {
  const kept = prepare(n);
  for (let j = 1; j <= 12; j++) assert.sameValue(prepare(n + j + 1000).first.y, n + j + 1059);
  assert.sameValue(kept.first === kept.second, true);
  assert.sameValue(kept.first.x, n);
  assert.sameValue(kept.first.y, n + 59);
}
