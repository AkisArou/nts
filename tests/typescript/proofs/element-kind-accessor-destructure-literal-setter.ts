/*---
description: A destructuring assignment invokes the setter stored in its assignment target.
features: [ts-proof-element-kind, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-accessors, ts-destructuring, ts-numbers]
---*/
// Fact: number[] starts with only integer elements (docs/foundations/objects.md, Arrays).
// Route: Node observes change > 0 ? -0 : 1; the operation result is checked separately.
function read(xs: number[]): number { return xs[0]; }
function observe(change: number) {
  const xs = [1, 2, 3];
  const gate = {
    set token(next: number) { if (next > 0) { xs.fill(-0); } }
  };
  const assigned = ({ token: gate.token } = { token: change });
  return { value: read(xs), token: assigned.token };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? -0 : 1);
  assert.sameValue(result.token, change);
}
