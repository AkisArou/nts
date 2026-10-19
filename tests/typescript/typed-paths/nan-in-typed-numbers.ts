/*---
description: NaN is a number: it flows through typed fields, is unequal to itself, and poisons arithmetic.
features: [ts-numbers]
---*/
const parsed: number = Number("abc");
const stats = { mean: parsed, count: 3 };
assert.sameValue(Number.isNaN(stats.mean), true);
assert.sameValue(stats.mean === stats.mean, false);
assert.sameValue(stats.mean + stats.count, Number.NaN);
assert.sameValue([1, Number.NaN].indexOf(Number.NaN), -1);
assert.sameValue([1, Number.NaN].includes(Number.NaN), true);
assert.sameValue(Math.max(1, Number.NaN), Number.NaN);
