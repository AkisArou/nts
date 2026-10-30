/*---
description: A finally edge can replace the receiver before a joined method call.
features: [ts-proof-call-target, ts-route-merge, ts-functions, ts-iteration, ts-class, ts-inheritance, ts-errors]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: finally may install Next on either incoming edge; node calls its override.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

function afterFinally(n: number): number {
  let target: Base = new Base();
  try {
    if (n < 0) throw new Error("caught");
  } catch {
  } finally {
    if (n !== 0) target = new Next();
  }
  return target.run(n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterFinally(n), (n !== 0 ? 200 : 100) + n);
}
