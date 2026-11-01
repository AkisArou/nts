/*---
description: Control for arithmetic-zero-divisor-parameter; local bigint constants preserve the same direct operations, exact values and errors.
features: [ts-bigint-route-arithmetic, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator, ts-expressions, ts-errors, ts-arrow-functions, ts-functions]
---*/
// Control: numeric selectors choose local bigint literals; the same operations run directly without a stored, returned or generic bigint carrier.
const expectedQuotient: bigint[] = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 1n, -1n, 0n, 0n, -1n, 1n, 0n, 0n, 2n, -2n, 0n, 0n, -2n, 2n, 0n, 0n, 3n, -3n, 1n, -1n, -3n, 3n, -1n, 1n, 7n, -7n, 2n, -2n, -7n, 7n, -2n, 2n, 9223372036854775807n, -9223372036854775807n, 3074457345618258602n, -3074457345618258602n, -9223372036854775808n, 9223372036854775808n, -3074457345618258602n, 3074457345618258602n, 18446744073709551616n, -18446744073709551616n, 6148914691236517205n, -6148914691236517205n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105727n, 56713727820156410577229101238628035242n, -56713727820156410577229101238628035242n, -170141183460469231731687303715884105728n, 170141183460469231731687303715884105728n, -56713727820156410577229101238628035242n, 56713727820156410577229101238628035242n, 9007199254740993n, -9007199254740993n, 3002399751580331n, -3002399751580331n];
const expectedRemainder: bigint[] = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 1n, 1n, 0n, 0n, -1n, -1n, 0n, 0n, 2n, 2n, 0n, 0n, -2n, -2n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 1n, 1n, 0n, 0n, -1n, -1n, 0n, 0n, 1n, 1n, 0n, 0n, -2n, -2n, 0n, 0n, 1n, 1n, 0n, 0n, 1n, 1n, 0n, 0n, -2n, -2n, 0n, 0n, 0n, 0n];
let checked = 0, rejected = 0;
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) for (const j of [0, 1, 2, 3, 4, 5]) {
  const a: bigint = i === 0 ? 0n : i === 1 ? -0n : i === 2 ? 1n : i === 3 ? -1n : i === 4 ? 2n : i === 5 ? -2n : i === 6 ? 3n : i === 7 ? -3n : i === 8 ? 7n : i === 9 ? -7n : i === 10 ? 9223372036854775807n : i === 11 ? -9223372036854775808n : i === 12 ? 18446744073709551616n : i === 13 ? 170141183460469231731687303715884105727n : i === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n;
  const b: bigint = j === 0 ? 0n : j === 1 ? -0n : j === 2 ? 1n : j === 3 ? -1n : j === 4 ? 3n : -3n;
  if (j < 2) {
    assert.throws(RangeError, () => { const a: bigint = i === 0 ? 0n : i === 1 ? -0n : i === 2 ? 1n : i === 3 ? -1n : i === 4 ? 2n : i === 5 ? -2n : i === 6 ? 3n : i === 7 ? -3n : i === 8 ? 7n : i === 9 ? -7n : i === 10 ? 9223372036854775807n : i === 11 ? -9223372036854775808n : i === 12 ? 18446744073709551616n : i === 13 ? 170141183460469231731687303715884105727n : i === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n; const b: bigint = j === 0 ? 0n : j === 1 ? -0n : j === 2 ? 1n : j === 3 ? -1n : j === 4 ? 3n : -3n; const result: bigint = a / b; assert.sameValue(typeof result, "bigint"); }); rejected++;
    assert.throws(RangeError, () => { const a: bigint = i === 0 ? 0n : i === 1 ? -0n : i === 2 ? 1n : i === 3 ? -1n : i === 4 ? 2n : i === 5 ? -2n : i === 6 ? 3n : i === 7 ? -3n : i === 8 ? 7n : i === 9 ? -7n : i === 10 ? 9223372036854775807n : i === 11 ? -9223372036854775808n : i === 12 ? 18446744073709551616n : i === 13 ? 170141183460469231731687303715884105727n : i === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n; const b: bigint = j === 0 ? 0n : j === 1 ? -0n : j === 2 ? 1n : j === 3 ? -1n : j === 4 ? 3n : -3n; const result: bigint = a % b; assert.sameValue(typeof result, "bigint"); }); rejected++;
  } else {
    const quotient: bigint = a / b;
    assert.sameValue(quotient, expectedQuotient[checked]); assert.sameValue(typeof quotient, "bigint");
    const remainder: bigint = a % b;
    assert.sameValue(remainder, expectedRemainder[checked]); assert.sameValue(typeof remainder, "bigint");
    checked++;
  }
}
assert.sameValue(checked, 64); assert.sameValue(rejected, 64);
