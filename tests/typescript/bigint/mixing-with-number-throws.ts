/*---
description: Mixing a bigint and a number in arithmetic throws TypeError; only comparisons mix.
features: [ts-bigint, ts-any]
---*/
const big: any = 10n;
assert.throws(TypeError, () => {
  big + 1;
});
assert.throws(TypeError, () => {
  +big;
});
const exact: bigint = 10n;
assert.sameValue(exact > 9, true);
assert.sameValue(exact < 10.5, true);
assert.sameValue(exact == (10 as unknown), true);
