/*---
description: Auto-increment continues from a negative or fractional member, and the reverse mapping keys are their strings.
features: [ts-enum, ts-enum-reverse-mapping]
---*/
enum Scale { Below = -1, Zero, Half = 0.5, OneAndHalf }
assert.sameValue(Scale.Zero, 0);
assert.sameValue(Scale.OneAndHalf, 1.5);
assert.sameValue(Scale[-1], "Below");
assert.sameValue(Scale[1.5], "OneAndHalf");
assert.sameValue(Object.keys(Scale).indexOf("-1") >= 0, true);
