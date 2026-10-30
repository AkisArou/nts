/*---
description: A String conversion in the left operand of in changes the fact used to build its right operand.
features: [ts-proof-negative-zero, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-conversions, ts-to-primitive, ts-to-string, ts-strings, ts-computed-keys, ts-expressions, ts-numbers]
---*/
// Fact: the literal value is positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: String(key) invokes toString before the right-hand object is built; node reads change > 0 ? -0 : 0 and membership is true exactly when change >= 0.
function observe(change: number) {
  let value = 0;
  const key = {
    toString(): string {
      if (change > 0) { value = -0; }
      return change < 0 ? "missing" : change > 0 ? "-Infinity" : "Infinity";
    }
  };
  const found = String(key) in { [1 / value]: true };
  return { value: value, found };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? -0 : 0);
  assert.sameValue(result.found, change >= 0);
}
