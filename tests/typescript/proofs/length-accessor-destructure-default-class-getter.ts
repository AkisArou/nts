/*---
description: A destructuring default invokes a class getter only on the missing-property path.
features: [ts-proof-length, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-accessors, ts-destructuring, ts-optional-properties]
---*/
// Fact: the literal allocation has length 3 (docs/foundations/objects.md, Arrays).
// Route: Node observes change > 0 ? 1 : 3; the operation result is checked separately.
function observe(change: number) {
  const xs = [1, 2, 3];
  class Gate {
    get token(): number { xs.length = 1; return change + 5; }
  }
  const gate = new Gate();
  const source: { token?: number } = change > 0 ? {} : { token: 9 };
  const { token = gate.token } = source;
  return { value: xs.length, token };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? 1 : 3);
  assert.sameValue(result.token, change > 0 ? change + 5 : 9);
}
