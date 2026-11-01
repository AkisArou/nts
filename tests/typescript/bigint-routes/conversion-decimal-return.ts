/*---
description: A declared bigint return preserves exact signed decimal parsing and surrounding whitespace across the 64-bit and 128-bit edges.
features: [ts-bigint-route-conversions, ts-bigint, ts-conversions, ts-strings, ts-functions, ts-arrays]
---*/
// Route: BigInt of decimal text leaves a function through its bigint return; node retains every digit and discards surrounding whitespace.
const inputs: string[] = ["0", "-0", "+1", "-1", " 2 ", "\t-2\n", "3", "-3", "\u00a07\u00a0", "\n-7\t", "9223372036854775807", "-9223372036854775808", " 18446744073709551616 ", "170141183460469231731687303715884105727", "-170141183460469231731687303715884105728", "+9007199254740993"];
function parseDecimal(value: string): bigint { return BigInt(value); }
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
let accepted = 0;
for (let index = 0; index < 16; index++) {
  const source: string = inputs[index];
    const result: bigint = parseDecimal(source);
    assert.sameValue(result, expected[index]); assert.sameValue(typeof result, "bigint");
    accepted++;
}
assert.sameValue(accepted, 16);
