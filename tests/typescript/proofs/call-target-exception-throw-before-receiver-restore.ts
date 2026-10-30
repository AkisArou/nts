/*---
description: A caught exception can leave a receiver replaced when its restoration was skipped.
features: [ts-proof-call-target, ts-route-exception, ts-functions, ts-iteration, ts-errors, ts-class, ts-inheritance]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the throw skips restoration of Base; node calls Next on the caught path.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

function afterThrow(n: number): number {
  let target: Base = new Base();
  try {
    target = new Next();
    if (n > 0) throw new Error("skip restore");
    target = new Base();
  } catch {
  }
  return target.run(n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterThrow(n), (n > 0 ? 200 : 100) + n);
}
