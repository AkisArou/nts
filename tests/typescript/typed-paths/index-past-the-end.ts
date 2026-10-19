/*---
description: Reading a number[] past its end gives undefined although the element type says number.
features: [ts-arrays, ts-null-undefined, ts-numbers]
---*/
const values: number[] = [1, 2];
const past = values[5];
assert.sameValue(past, undefined);
assert.sameValue(values[-1], undefined);
assert.sameValue(past + 1, Number.NaN);
let total = 0;
for (let i = 0; i <= values.length; i++) total += values[i] ?? 100;
assert.sameValue(total, 103);
