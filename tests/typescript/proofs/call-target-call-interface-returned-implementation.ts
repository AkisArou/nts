/*---
description: A call can return any of three interface implementations to replace a known target.
features: [ts-proof-call-target, ts-route-call, ts-functions, ts-iteration, ts-interfaces, ts-class]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: a returned interface value changes the concrete class; node calls its actual implementation.
interface Worker { run(n: number): number; }
class First implements Worker { run(n: number): number { return 100 + n; } }
class Second implements Worker { run(n: number): number { return 200 + n; } }

class Third implements Worker { run(n: number): number { return 300 + n; } }
function choose(original: Worker, n: number): Worker {
  if (n === 1) return new Second();
  return n > 1 ? new Third() : original;
}
function afterCall(n: number): number {
  let target: Worker = new First();
  target = choose(target, n);
  return target.run(n);
}
for (const n of [-1, 0, 1, 2, 3, 7]) {
  assert.sameValue(afterCall(n), (n === 1 ? 200 : n > 1 ? 300 : 100) + n);
}
