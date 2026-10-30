/*---
description: A String conversion in the left operand of in changes the fact used to build its right operand.
features: [ts-proof-length, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-conversions, ts-to-primitive, ts-to-string, ts-strings, ts-computed-keys, ts-expressions]
---*/
// Fact: the literal allocation has length 3 (docs/foundations/objects.md, Arrays).
// Route: String(key) invokes toString before the right-hand object is built; node reads change > 0 ? 4 : 3 and membership is true exactly when change >= 0.
function observe(change: number) {
  const xs = [1, 2, 3];
  const key = {
    toString(): string {
      if (change > 0) { xs.push(4); }
      return change < 0 ? "missing" : change > 0 ? "4" : "3";
    }
  };
  const found = String(key) in { [xs.length]: true };
  return { value: xs.length, found };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? 4 : 3);
  assert.sameValue(result.found, change >= 0);
}
