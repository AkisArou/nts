/*---
description: Object spread invokes a getter that changes an already established fact.
features: [ts-proof-length, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-accessors, ts-spread]
---*/
// Fact: the literal allocation has length 3 (docs/foundations/objects.md, Arrays).
// Route: Node observes change > 0 ? 2 : 3; the operation result is checked separately.
function observe(change: number) {
  const xs = [1, 2, 3];
  const gate = {
    get token(): number { if (change > 0) { xs.splice(1, 1); } return change + 5; }
  };
  const copied = { ...gate };
  return { value: xs.length, token: copied.token };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? 2 : 3);
  assert.sameValue(result.token, change + 5);
}
