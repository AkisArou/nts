/*---
description: Converting a computed property key changes the fact read by its property value.
features: [ts-proof-whole-number, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-conversions, ts-to-primitive, ts-to-string, ts-strings, ts-computed-keys, ts-numbers]
---*/
// Fact: the literal value is a whole number in range (docs/foundations/numbers.md, Integers proved from doubles).
// Route: Node observes change > 0 ? -2147483649 : 1; the operation result is checked separately.
function observe(change: number) {
  let value = 1;
  const key = {
    toString(): string { if (change > 0) { value = -2147483649; } return "sample"; }
  };
  return { [String(key)]: value };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue("sample" in result, true);
  assert.sameValue(result.sample, change > 0 ? -2147483649 : 1);
}
