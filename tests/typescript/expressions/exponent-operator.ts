/*---
description: The exponent operator is right-associative and works on typed numbers and through `**=`.
features: [ts-exponent]
---*/
const base = 2;
let power = 3;
assert.sameValue(base ** power, 8);
assert.sameValue(base ** power ** 2, 512);
assert.sameValue((-base) ** 2, 4);
power = 16;
power **= 0.5;
assert.sameValue(power, 4);
assert.sameValue(4 ** -0.5, 0.5);
