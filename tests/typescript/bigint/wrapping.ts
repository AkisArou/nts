/*---
description: BigInt.asIntN and asUintN wrap a bigint to a fixed width, as fixed-size integers do.
features: [ts-bigint]
---*/
assert.sameValue(BigInt.asUintN(8, 257n), 1n);
assert.sameValue(BigInt.asIntN(8, 255n), -1n);
assert.sameValue(BigInt.asIntN(64, 2n ** 63n), -(2n ** 63n));
assert.sameValue(BigInt.asUintN(64, -1n), 18446744073709551615n);
