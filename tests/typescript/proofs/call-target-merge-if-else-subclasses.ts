/*---
description: An if-else join retains the class of its replacement receiver.
features: [ts-proof-call-target, ts-route-merge, ts-functions, ts-iteration, ts-class, ts-inheritance]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the branch may replace Base with Next; node runs the selected override.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

function afterJoin(n: number): number {
  let target: Base = new Base();
  if (n > 0) target = new Next();
  else target = new Base();
  return target.run(n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), (n > 0 ? 200 : 100) + n);
}
