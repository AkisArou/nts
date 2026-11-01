/*---
description: Bigint fields preserve signed addition and subtraction across the 64-bit and 128-bit edges.
features: [ts-bigint-route-arithmetic, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator, ts-expressions, ts-objects]
---*/
// Bigint left/right fields carry signed edge operands; node returns exact sums and differences, including results past 128 bits.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const others: bigint[] = [3n, -3n];
const operand: { value: bigint; other: bigint } = { value: 0n, other: 0n };
const expectedAdded: bigint[] = [3n, -3n, 3n, -3n, 4n, -2n, 2n, -4n, 5n, -1n, 1n, -5n, 6n, 0n, 0n, -6n, 10n, 4n, -4n, -10n, 9223372036854775810n, 9223372036854775804n, -9223372036854775805n, -9223372036854775811n, 18446744073709551619n, 18446744073709551613n, 170141183460469231731687303715884105730n, 170141183460469231731687303715884105724n, -170141183460469231731687303715884105725n, -170141183460469231731687303715884105731n, 9007199254740996n, 9007199254740990n];
const expectedSubtracted: bigint[] = [-3n, 3n, -3n, 3n, -2n, 4n, -4n, 2n, -1n, 5n, -5n, 1n, 0n, 6n, -6n, 0n, 4n, 10n, -10n, -4n, 9223372036854775804n, 9223372036854775810n, -9223372036854775811n, -9223372036854775805n, 18446744073709551613n, 18446744073709551619n, 170141183460469231731687303715884105724n, 170141183460469231731687303715884105730n, -170141183460469231731687303715884105731n, -170141183460469231731687303715884105725n, 9007199254740990n, 9007199254740996n];
let checked = 0;
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) for (const j of [0, 1]) {
  const a: bigint = inputs[i];
  const b: bigint = others[j];
  operand.value = a; operand.other = b;
  const added: bigint = operand.value + operand.other;
  assert.sameValue(added, expectedAdded[checked]); assert.sameValue(typeof added, "bigint");
  const subtracted: bigint = operand.value - operand.other;
  assert.sameValue(subtracted, expectedSubtracted[checked]); assert.sameValue(typeof subtracted, "bigint");
  checked++;
}
assert.sameValue(checked, 32);
