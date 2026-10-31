/*---
description: A module slot retains a local object while non-publishing calls reuse its allocation site.
features: [ts-lifetime-frame, ts-route-global, ts-functions, ts-iteration, ts-objects, ts-modules]
flags: [module]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: a module store outlives the producer; node preserves the saved pair and identity.
type Point = { x: number; y: number };
type Pair = { first: Point; second: Point };
let saved: Pair | null = null;
function prepare(n: number, keep: boolean): number {
  const point = { x: n, y: n + 9 };
  point.y += n;
  if (keep) saved = { first: point, second: point };
  return point.x + point.y;
}
function read(): Pair {
  if (saved === null) throw new Test262Error("missing module value");
  return saved;
}
for (let n = 0; n < 240; n++) {
  assert.sameValue(prepare(n, true), 3 * n + 9);
  for (let j = 1; j <= 16; j++) {
    assert.sameValue(prepare(n + j + 1000, false), 3 * (n + j + 1000) + 9);
  }
  const kept = read();
  assert.sameValue(kept.first === kept.second, true);
  assert.sameValue(kept.first.x, n);
  assert.sameValue(kept.first.y, 2 * n + 9);
  saved = null;
}
