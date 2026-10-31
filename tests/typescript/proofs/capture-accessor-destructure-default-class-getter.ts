/*---
description: A destructuring default invokes a class getter only on the missing-property path.
features: [ts-proof-capture, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-accessors, ts-destructuring, ts-optional-properties, ts-arrow-functions, ts-function-types]
---*/
// Fact: the reader is created before any write to its binding (docs/foundations/objects.md, Functions as values).
// Route: Node observes change > 0 ? 10 + change : 10; the operation result is checked separately.
function observe(change: number) {
  let value = 10;
  const read = (): number => value;
  class Gate {
    get token(): number { value = 10 + change; return change + 5; }
  }
  const gate = new Gate();
  const source: { token?: number } = change > 0 ? {} : { token: 9 };
  const { token = gate.token } = source;
  return { value: read(), token };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? 10 + change : 10);
  assert.sameValue(result.token, change > 0 ? change + 5 : 9);
}
