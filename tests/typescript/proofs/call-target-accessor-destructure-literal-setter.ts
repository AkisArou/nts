/*---
description: A destructuring assignment invokes the setter stored in its assignment target.
features: [ts-proof-call-target, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-accessors, ts-destructuring, ts-class, ts-inheritance, ts-override]
---*/
// Fact: new Base establishes the receiver class (docs/foundations/objects.md, Calls).
// Route: Node observes (change > 0 ? 200 : 100) + change; the operation result is checked separately.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }
function observe(change: number) {
  let target: Base = new Base();
  const gate = {
    set token(next: number) { if (next > 0) { target = new Next(); } }
  };
  const assigned = ({ token: gate.token } = { token: change });
  return { value: target.run(change), token: assigned.token };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, (change > 0 ? 200 : 100) + change);
  assert.sameValue(result.token, change);
}
