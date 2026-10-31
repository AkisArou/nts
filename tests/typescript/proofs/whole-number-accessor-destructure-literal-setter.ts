/*---
description: A destructuring assignment invokes the setter stored in its assignment target.
features: [ts-proof-whole-number, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-accessors, ts-destructuring, ts-numbers]
---*/
// Fact: the literal value is a whole number in range (docs/foundations/numbers.md, Integers proved from doubles).
// Route: Node observes change > 0 ? 4294967296 : 1; the operation result is checked separately.
function observe(change: number) {
  let value = 1;
  const gate = {
    set token(next: number) { if (next > 0) { value = 4294967296; } }
  };
  const assigned = ({ token: gate.token } = { token: change });
  return { value: value, token: assigned.token };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? 4294967296 : 1);
  assert.sameValue(result.token, change);
}
