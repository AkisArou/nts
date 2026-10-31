/*---
description: A destructuring default invokes a class getter only on the missing-property path.
features: [ts-proof-call-target, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-accessors, ts-destructuring, ts-optional-properties, ts-inheritance, ts-override]
---*/
// Fact: new Base establishes the receiver class (docs/foundations/objects.md, Calls).
// Route: Node observes (change > 0 ? 200 : 100) + change; the operation result is checked separately.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }
function observe(change: number) {
  let target: Base = new Base();
  class Gate {
    get token(): number { target = new Next(); return change + 5; }
  }
  const gate = new Gate();
  const source: { token?: number } = change > 0 ? {} : { token: 9 };
  const { token = gate.token } = source;
  return { value: target.run(change), token };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, (change > 0 ? 200 : 100) + change);
  assert.sameValue(result.token, change > 0 ? change + 5 : 9);
}
