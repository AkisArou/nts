/*---
description: Object spread shifts a guarded array and the surviving index reads its moved element.
features: [ts-proof-bounds, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-accessors, ts-spread]
---*/
// Fact: index 1 stays in range after one shift (docs/foundations/objects.md, Arrays).
// Route: Node observes change > 0 ? 33 : 22; the operation result is checked separately.
function observe(change: number) {
  const xs = [11, 22, 33, 44];
  const index = 1;
  const gate = {
    get token(): number { if (change > 0) xs.shift(); return change + 5; }
  };
  if (index < xs.length) {
    const copied = { ...gate };
    return { value: xs[index], token: copied.token };
  }
  return { value: -1, token: -1 };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? 33 : 22);
  assert.sameValue(result.token, change + 5);
}
