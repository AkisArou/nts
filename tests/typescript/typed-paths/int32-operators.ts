/*---
description: Bitwise and shift operators convert a typed number to a 32-bit integer and wrap.
features: [ts-numbers]
---*/
const large: number = 2 ** 32 + 5;
assert.sameValue(large | 0, 5);
assert.sameValue((2 ** 31) | 0, -2147483648);
assert.sameValue(1 << 31, -2147483648);
assert.sameValue(1 << 32, 1);
assert.sameValue(-1 >>> 0, 4294967295);
assert.sameValue(-8 >> 1, -4);
assert.sameValue(3.9 | 0, 3);
assert.sameValue(-3.9 | 0, -3);
assert.sameValue(~~-0.5, 0);
