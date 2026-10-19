/*---
description: Bitwise operators on bigints act on two's-complement values of unlimited width.
features: [ts-bigint]
---*/
const a: bigint = 0b1100n;
const b: bigint = 0b1010n;
assert.sameValue(a & b, 0b1000n);
assert.sameValue(a | b, 0b1110n);
assert.sameValue(a ^ b, 0b0110n);
assert.sameValue(~a, -13n);
assert.sameValue(1n << 70n, 1180591620717411303424n);
assert.sameValue(-9n >> 1n, -5n);
