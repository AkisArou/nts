/*---
description: Math functions on typed numbers follow IEEE and the language's rounding rules at their edges.
features: [ts-numbers]
---*/
assert.sameValue(Math.round(2.5), 3);
assert.sameValue(Math.round(-2.5), -2);
assert.sameValue(Math.round(-0.5), -0);
assert.sameValue(Math.max(), -Infinity);
assert.sameValue(Math.min(), Infinity);
assert.sameValue(Math.sign(-3), -1);
assert.sameValue(Math.trunc(-0.9), -0);
assert.sameValue(Math.hypot(3, 4), 5);
assert.sameValue(Math.sqrt(-1), Number.NaN);
assert.sameValue(Number.EPSILON > 0 && 1 + Number.EPSILON !== 1, true);
