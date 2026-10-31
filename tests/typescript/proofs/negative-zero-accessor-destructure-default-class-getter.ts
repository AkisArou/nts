/*---
description: A destructuring default invokes a class getter only on the missing-property path.
features: [ts-proof-negative-zero, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-accessors, ts-destructuring, ts-optional-properties, ts-numbers]
---*/
// Fact: the literal value is positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: Node observes change > 0 ? -0 : 0; the operation result is checked separately.
function observe(change: number) {
  let value = 0;
  class Gate {
    get token(): number { value = -0; return change + 5; }
  }
  const gate = new Gate();
  const source: { token?: number } = change > 0 ? {} : { token: 9 };
  const { token = gate.token } = source;
  return { value: value, token };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? -0 : 0);
  assert.sameValue(result.token, change > 0 ? change + 5 : 9);
}
