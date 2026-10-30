/*---
description: A destructuring default invokes a class getter only on the missing-property path.
features: [ts-proof-element-kind, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-accessors, ts-destructuring, ts-optional-properties, ts-numbers]
---*/
// Fact: number[] starts with only integer elements (docs/foundations/objects.md, Arrays).
// Route: Node observes change > 0 ? NaN : 1; the operation result is checked separately.
function read(xs: number[]): number { return xs[0]; }
function observe(change: number) {
  const xs = [1, 2, 3];
  class Gate {
    get token(): number { xs[0] = NaN; return change + 5; }
  }
  const gate = new Gate();
  const source: { token?: number } = change > 0 ? {} : { token: 9 };
  const { token = gate.token } = source;
  return { value: read(xs), token };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? NaN : 1);
  assert.sameValue(result.token, change > 0 ? change + 5 : 9);
}
