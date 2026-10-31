/*---
description: A destructuring assignment invokes the setter stored in its assignment target.
features: [ts-proof-length, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-accessors, ts-destructuring]
---*/
// Fact: the literal allocation has length 3 (docs/foundations/objects.md, Arrays).
// Route: Node observes change > 0 ? 6 : 3; the operation result is checked separately.
function observe(change: number) {
  const xs = [1, 2, 3];
  const gate = {
    set token(next: number) { if (next > 0) { xs[5] = 6; } }
  };
  const assigned = ({ token: gate.token } = { token: change });
  return { value: xs.length, token: assigned.token };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? 6 : 3);
  assert.sameValue(result.token, change);
}
