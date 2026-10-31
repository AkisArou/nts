/*---
description: A destructuring assignment invokes the setter stored in its assignment target.
features: [ts-proof-capture, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-accessors, ts-destructuring, ts-arrow-functions, ts-function-types]
---*/
// Fact: the reader is created before any write to its binding (docs/foundations/objects.md, Functions as values).
// Route: Node observes change > 0 ? 10 + change : 10; the operation result is checked separately.
function observe(change: number) {
  let value = 10;
  const read = (): number => value;
  const gate = {
    set token(next: number) { if (next > 0) { value = 10 + next; } }
  };
  const assigned = ({ token: gate.token } = { token: change });
  return { value: read(), token: assigned.token };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? 10 + change : 10);
  assert.sameValue(result.token, change);
}
