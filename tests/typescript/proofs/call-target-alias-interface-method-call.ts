/*---
description: An alias replaces an extracted interface method and its matching receiver before call.
features: [ts-proof-call-target, ts-route-alias, ts-functions, ts-iteration, ts-objects, ts-interfaces, ts-class, ts-this]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the function field and its original instance change together; node calls Second.run.
interface Worker { run(n: number): number; }
class First implements Worker { run(n: number): number { return 100 + n; } }
class Second implements Worker { run(n: number): number { return 200 + n; } }

function afterAlias(n: number): number {
  const first: Worker = new First();
  const holder: { receiver: Worker; action: (n: number) => number } = {
    receiver: first, action: first.run
  };
  const alias = holder;
  if (n > 0) {
    const second: Worker = new Second();
    alias.receiver = second;
    alias.action = second.run;
  }
  return holder.action.call(holder.receiver, n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterAlias(n), (n > 0 ? 200 : 100) + n);
}
