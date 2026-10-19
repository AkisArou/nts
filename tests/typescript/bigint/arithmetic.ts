/*---
description: BigInt arithmetic on typed operands, with division truncating toward zero.
features: [ts-bigint]
---*/
const a: bigint = 17n;
const b: bigint = 5n;
assert.sameValue(a + b, 22n);
assert.sameValue(a - b * 4n, -3n);
assert.sameValue(a / b, 3n);
assert.sameValue(-a / b, -3n);
assert.sameValue(a % b, 2n);
assert.sameValue(-a % b, -2n);
assert.sameValue(b ** 3n, 125n);
assert.sameValue(-b, -5n);
