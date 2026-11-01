/*---
description: A number parameter converted to bigint preserves the integral double exactly and rejects fractional or non-finite inputs.
features: [ts-bigint-route-conversions, ts-bigint, ts-conversions, ts-numbers, ts-functions, ts-errors, ts-arrays, ts-arrow-functions]
---*/
// Route: a number parameter reaches BigInt; node converts the actual integral double and throws RangeError for every fractional or non-finite input.
const inputs: number[] = [0, -0, 1, -1, 2, -2, 3, -3, 9007199254740992, 9007199254740994, 9223372036854775807, -9223372036854775808, 18446744073709551616, 170141183460469231731687303715884105727, -170141183460469231731687303715884105728, 0.5, -1.5, NaN, Infinity, -Infinity];
function convertNumber(value: number): bigint { return BigInt(value); }
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 9007199254740992n, 9007199254740994n, 9223372036854775808n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105728n, -170141183460469231731687303715884105728n];
let accepted = 0, rejected = 0;
for (let index = 0; index < 20; index++) {
  const source: number = inputs[index];
  if (index < 15) {
    const result: bigint = convertNumber(source);
    assert.sameValue(result, expected[index]); assert.sameValue(typeof result, "bigint");
    accepted++;
  } else {
    assert.throws(RangeError, () => { convertNumber(source); }); rejected++;
  }
}
assert.sameValue(accepted, 15); assert.sameValue(rejected, 5);
