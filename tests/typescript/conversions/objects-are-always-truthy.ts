/*---
description: An object is truthy without being converted: valueOf is not called by a boolean test.
features: [ts-conversions, ts-class]
---*/
let conversions = 0;
class Zero {
  valueOf(): number {
    conversions++;
    return 0;
  }
}
const zero = new Zero();
assert.sameValue(zero ? "truthy" : "falsy", "truthy");
assert.sameValue(!zero, false);
assert.sameValue(Boolean(zero), true);
assert.sameValue(conversions, 0);
assert.sameValue(+zero ? "truthy" : "falsy", "falsy");
assert.sameValue(conversions, 1);
