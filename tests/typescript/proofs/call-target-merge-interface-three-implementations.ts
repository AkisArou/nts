/*---
description: An interface join retains three distinct implementation targets.
features: [ts-proof-call-target, ts-route-merge, ts-functions, ts-iteration, ts-interfaces, ts-class]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the join admits three classes; node calls the implementation actually selected.
interface Worker { run(n: number): number; }
class First implements Worker { run(n: number): number { return 100 + n; } }
class Second implements Worker { run(n: number): number { return 200 + n; } }

class Third implements Worker { run(n: number): number { return 300 + n; } }
function afterChoice(n: number): number {
  let target: Worker = new First();
  if (n === 1) target = new Second();
  else if (n > 1) target = new Third();
  return target.run(n);
}
for (const n of [-1, 0, 1, 2, 3, 7]) {
  assert.sameValue(afterChoice(n), (n === 1 ? 200 : n > 1 ? 300 : 100) + n);
}
