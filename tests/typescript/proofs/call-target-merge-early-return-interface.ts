/*---
description: An early return leaves the replacement interface target on the surviving path.
features: [ts-proof-call-target, ts-route-merge, ts-functions, ts-iteration, ts-interfaces, ts-class]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the surviving path replaces First; node calls Second.run.
interface Worker { run(n: number): number; }
class First implements Worker { run(n: number): number { return 100 + n; } }
class Second implements Worker { run(n: number): number { return 200 + n; } }

function afterReturn(n: number): number {
  let target: Worker = new First();
  if (n <= 0) return target.run(n);
  target = new Second();
  return target.run(n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterReturn(n), (n > 0 ? 200 : 100) + n);
}
