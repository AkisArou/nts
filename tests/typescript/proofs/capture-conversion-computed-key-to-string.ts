/*---
description: Converting a computed property key changes the fact read by its property value.
features: [ts-proof-capture, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-conversions, ts-to-primitive, ts-to-string, ts-strings, ts-computed-keys, ts-arrow-functions, ts-function-types]
---*/
// Fact: the reader is created before any write to its binding (docs/foundations/objects.md, Functions as values).
// Route: Node observes change > 0 ? 10 + change : 10; the operation result is checked separately.
function observe(change: number) {
  let value = 10;
  const read = (): number => value;
  const key = {
    toString(): string { if (change > 0) { value = 10 + change; } return "sample"; }
  };
  return { [String(key)]: read() };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue("sample" in result, true);
  assert.sameValue(result.sample, change > 0 ? 10 + change : 10);
}
