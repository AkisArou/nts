/*---
description: Converting a computed property key changes the fact read by its property value.
features: [ts-proof-element-kind, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-conversions, ts-to-primitive, ts-to-string, ts-strings, ts-computed-keys, ts-numbers]
---*/
// Fact: number[] starts with only integer elements (docs/foundations/objects.md, Arrays).
// Route: Node observes change > 0 ? Infinity : 1; the operation result is checked separately.
function read(xs: number[]): number { return xs[0]; }
function observe(change: number) {
  const xs = [1, 2, 3];
  const key = {
    toString(): string { if (change > 0) { xs[0] = Infinity; } return "sample"; }
  };
  return { [String(key)]: read(xs) };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue("sample" in result, true);
  assert.sameValue(result.sample, change > 0 ? Infinity : 1);
}
