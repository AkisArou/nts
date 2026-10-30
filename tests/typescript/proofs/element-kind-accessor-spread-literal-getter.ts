/*---
description: Object spread invokes a getter that changes an already established fact.
features: [ts-proof-element-kind, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-accessors, ts-spread, ts-numbers]
---*/
// Fact: number[] starts with only integer elements (docs/foundations/objects.md, Arrays).
// Route: Node observes change > 0 ? 0.5 : 3; the operation result is checked separately.
function read(xs: number[]): number { return xs[xs.length - 1]; }
function observe(change: number) {
  const xs = [1, 2, 3];
  const gate = {
    get token(): number { if (change > 0) { xs.push(0.5); } return change + 5; }
  };
  const copied = { ...gate };
  return { value: read(xs), token: copied.token };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? 0.5 : 3);
  assert.sameValue(result.token, change + 5);
}
