/*---
description: Number arithmetic does not wrap at 32 bits, and stays exact up to 2^53.
features: [ts-numbers]
---*/
let n: number = 2 ** 31 - 1;
n += 1;
assert.sameValue(n, 2147483648);
const big: number = 2 ** 40 * 3;
assert.sameValue(big, 3298534883328);
assert.sameValue(Number.MAX_SAFE_INTEGER + 1, 2 ** 53);
assert.sameValue(Number.MAX_SAFE_INTEGER + 2, 2 ** 53);
assert.sameValue(4294967296 * 4294967296, 18446744073709552000);
