/*---
description: Control for arithmetic-add-subtract-field; local bigint constants preserve the same direct operations, exact values and errors.
features: [ts-bigint-route-arithmetic, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator, ts-expressions]
---*/
// Control: numeric selectors choose local bigint literals; the same operations run directly without a stored, returned or generic bigint carrier.
const expectedAdded: bigint[] = [3n, -3n, 3n, -3n, 4n, -2n, 2n, -4n, 5n, -1n, 1n, -5n, 6n, 0n, 0n, -6n, 10n, 4n, -4n, -10n, 9223372036854775810n, 9223372036854775804n, -9223372036854775805n, -9223372036854775811n, 18446744073709551619n, 18446744073709551613n, 170141183460469231731687303715884105730n, 170141183460469231731687303715884105724n, -170141183460469231731687303715884105725n, -170141183460469231731687303715884105731n, 9007199254740996n, 9007199254740990n];
const expectedSubtracted: bigint[] = [-3n, 3n, -3n, 3n, -2n, 4n, -4n, 2n, -1n, 5n, -5n, 1n, 0n, 6n, -6n, 0n, 4n, 10n, -10n, -4n, 9223372036854775804n, 9223372036854775810n, -9223372036854775811n, -9223372036854775805n, 18446744073709551613n, 18446744073709551619n, 170141183460469231731687303715884105724n, 170141183460469231731687303715884105730n, -170141183460469231731687303715884105731n, -170141183460469231731687303715884105725n, 9007199254740990n, 9007199254740996n];
let checked = 0;
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) for (const j of [0, 1]) {
  const a: bigint = i === 0 ? 0n : i === 1 ? -0n : i === 2 ? 1n : i === 3 ? -1n : i === 4 ? 2n : i === 5 ? -2n : i === 6 ? 3n : i === 7 ? -3n : i === 8 ? 7n : i === 9 ? -7n : i === 10 ? 9223372036854775807n : i === 11 ? -9223372036854775808n : i === 12 ? 18446744073709551616n : i === 13 ? 170141183460469231731687303715884105727n : i === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n;
  const b: bigint = j === 0 ? 3n : -3n;
  const added: bigint = a + b;
  assert.sameValue(added, expectedAdded[checked]); assert.sameValue(typeof added, "bigint");
  const subtracted: bigint = a - b;
  assert.sameValue(subtracted, expectedSubtracted[checked]); assert.sameValue(typeof subtracted, "bigint");
  checked++;
}
assert.sameValue(checked, 32);
