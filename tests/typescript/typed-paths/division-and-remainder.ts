/*---
description: Dividing typed integers gives a fraction; the remainder takes the dividend's sign and works on fractions.
features: [ts-numbers]
---*/
const a: number = 7;
const b: number = 2;
assert.sameValue(a / b, 3.5);
assert.sameValue(Math.trunc(-a / b), -3);
assert.sameValue(Math.floor(-a / b), -4);
assert.sameValue(-7 % 3, -1);
assert.sameValue(7 % -3, 1);
assert.sameValue(5.5 % 2, 1.5);
assert.sameValue(1 / 0, Infinity);
assert.sameValue(-1 / 0, -Infinity);
assert.sameValue(0 / 0, Number.NaN);
assert.sameValue(-6 % 3, -0);
