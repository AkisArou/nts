/*---
description: A Map alias replaces the implementation later recovered for dispatch.
features: [ts-proof-call-target, ts-route-alias, ts-functions, ts-iteration, ts-map-set, ts-interfaces, ts-class, ts-null-undefined]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the Map alias replaces First; node dispatches to the recovered Second.
interface Worker { run(n: number): number; }
class First implements Worker { run(n: number): number { return 100 + n; } }
class Second implements Worker { run(n: number): number { return 200 + n; } }

function afterAlias(n: number): number {
  const targets = new Map<string, Worker>([["target", new First()]]);
  const alias = targets;
  if (n > 0) alias.set("target", new Second());
  const target = targets.get("target");
  if (target === undefined) return -1;
  return target.run(n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterAlias(n), (n > 0 ? 200 : 100) + n);
}
