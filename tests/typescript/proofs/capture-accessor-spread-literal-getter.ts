/*---
description: Object spread invokes a getter that changes an already established fact.
features: [ts-proof-capture, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-accessors, ts-spread, ts-arrow-functions, ts-function-types]
---*/
// Fact: the reader is created before any write to its binding (docs/foundations/objects.md, Functions as values).
// Route: Node observes change > 0 ? 10 + change : 10; the operation result is checked separately.
function observe(change: number) {
  let value = 10;
  const read = (): number => value;
  const gate = {
    get token(): number { if (change > 0) { value = 10 + change; } return change + 5; }
  };
  const copied = { ...gate };
  return { value: read(), token: copied.token };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? 10 + change : 10);
  assert.sameValue(result.token, change + 5);
}
