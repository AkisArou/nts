/*---
description: BigInts stay exact past 2^53, where numbers do not.
features: [ts-bigint, ts-numbers]
---*/
const big: bigint = 2n ** 64n;
assert.sameValue(big.toString(), "18446744073709551616");
assert.sameValue(big - 1n, 18446744073709551615n);
const unsafe: number = 2 ** 53;
assert.sameValue(unsafe + 1 === unsafe, true);
assert.sameValue(BigInt(unsafe) + 1n === BigInt(unsafe), false);
assert.sameValue((10n ** 30n).toString().length, 31);
