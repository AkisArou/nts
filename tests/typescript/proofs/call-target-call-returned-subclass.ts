/*---
description: A callee can return a different subclass to replace the known receiver.
features: [ts-proof-call-target, ts-route-call, ts-functions, ts-iteration, ts-class, ts-inheritance]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the returned value changes the receiver class; node calls the returned subclass.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

function choose(original: Base, n: number): Base {
  return n > 0 ? new Next() : original;
}
function afterCall(n: number): number {
  let target: Base = new Base();
  target = choose(target, n);
  return target.run(n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterCall(n), (n > 0 ? 200 : 100) + n);
}
