/*---
description: A String conversion in the left operand of in changes the fact used to build its right operand.
features: [ts-proof-call-target, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-conversions, ts-to-primitive, ts-to-string, ts-strings, ts-computed-keys, ts-expressions, ts-class, ts-inheritance, ts-override]
---*/
// Fact: new Base establishes the receiver class (docs/foundations/objects.md, Calls).
// Route: String(key) invokes toString before the right-hand object is built; node reads (change > 0 ? 200 : 100) + change and membership is true exactly when change >= 0.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }
function observe(change: number) {
  let target: Base = new Base();
  const key = {
    toString(): string {
      if (change > 0) { target = new Next(); }
      return change < 0 ? "missing" : String((change > 0 ? 200 : 100) + change);
    }
  };
  const found = String(key) in { [target.run(change)]: true };
  return { value: target.run(change), found };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, (change > 0 ? 200 : 100) + change);
  assert.sameValue(result.found, change >= 0);
}
