/*---
description: Bigint parameters preserve successful division and remainder and throw RangeError for both zero spellings.
features: [ts-bigint-route-arithmetic, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator, ts-expressions, ts-errors, ts-arrow-functions, ts-functions]
---*/
// Bigint parameters meet at / and %; node throws RangeError for 0n and -0n and preserves every nonzero quotient and remainder.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const others: bigint[] = [0n, -0n, 1n, -1n, 3n, -3n];
function quotientRoute(a: bigint, b: bigint): bigint { return a / b; }
function remainderRoute(a: bigint, b: bigint): bigint { return a % b; }
const expectedQuotient: bigint[] = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 1n, -1n, 0n, 0n, -1n, 1n, 0n, 0n, 2n, -2n, 0n, 0n, -2n, 2n, 0n, 0n, 3n, -3n, 1n, -1n, -3n, 3n, -1n, 1n, 7n, -7n, 2n, -2n, -7n, 7n, -2n, 2n, 9223372036854775807n, -9223372036854775807n, 3074457345618258602n, -3074457345618258602n, -9223372036854775808n, 9223372036854775808n, -3074457345618258602n, 3074457345618258602n, 18446744073709551616n, -18446744073709551616n, 6148914691236517205n, -6148914691236517205n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105727n, 56713727820156410577229101238628035242n, -56713727820156410577229101238628035242n, -170141183460469231731687303715884105728n, 170141183460469231731687303715884105728n, -56713727820156410577229101238628035242n, 56713727820156410577229101238628035242n, 9007199254740993n, -9007199254740993n, 3002399751580331n, -3002399751580331n];
const expectedRemainder: bigint[] = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 1n, 1n, 0n, 0n, -1n, -1n, 0n, 0n, 2n, 2n, 0n, 0n, -2n, -2n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 1n, 1n, 0n, 0n, -1n, -1n, 0n, 0n, 1n, 1n, 0n, 0n, -2n, -2n, 0n, 0n, 1n, 1n, 0n, 0n, 1n, 1n, 0n, 0n, -2n, -2n, 0n, 0n, 0n, 0n];
let checked = 0, rejected = 0;
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) for (const j of [0, 1, 2, 3, 4, 5]) {
  const a: bigint = inputs[i];
  const b: bigint = others[j];
  if (j < 2) {
    assert.throws(RangeError, () => { const result: bigint = quotientRoute(a, b); assert.sameValue(typeof result, "bigint"); }); rejected++;
    assert.throws(RangeError, () => { const result: bigint = remainderRoute(a, b); assert.sameValue(typeof result, "bigint"); }); rejected++;
  } else {
    const quotient: bigint = quotientRoute(a, b);
    assert.sameValue(quotient, expectedQuotient[checked]); assert.sameValue(typeof quotient, "bigint");
    const remainder: bigint = remainderRoute(a, b);
    assert.sameValue(remainder, expectedRemainder[checked]); assert.sameValue(typeof remainder, "bigint");
    checked++;
  }
}
assert.sameValue(checked, 64); assert.sameValue(rejected, 64);
