/*---
description: Control for boundary-json-field; local bigint constants preserve the same boundary results and exceptions.
features: [ts-bigint-route-boundaries, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator, ts-objects, ts-numbers, ts-strings, ts-errors, ts-arrow-functions, ts-functions, ts-json-stringify]
---*/
// Control: numeric selectors choose local bigint literals; direct operations replace the tested storage or generic route.
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const expectedText: string[] = ["{\"value\":0}", "{\"value\":1}", "{\"value\":2}", "{\"value\":3}", "{\"value\":4}", "{\"value\":5}", "{\"value\":6}", "{\"value\":7}", "{\"value\":8}", "{\"value\":9}", "{\"value\":10}", "{\"value\":11}", "{\"value\":12}", "{\"value\":13}", "{\"value\":14}", "{\"value\":15}"];
let attempts = 0;
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const value: bigint = i === 0 ? 0n : i === 1 ? -0n : i === 2 ? 1n : i === 3 ? -1n : i === 4 ? 2n : i === 5 ? -2n : i === 6 ? 3n : i === 7 ? -3n : i === 8 ? 7n : i === 9 ? -7n : i === 10 ? 9223372036854775807n : i === 11 ? -9223372036854775808n : i === 12 ? 18446744073709551616n : i === 13 ? 170141183460469231731687303715884105727n : i === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n;
  assert.sameValue(value, expected[i]); assert.sameValue(typeof value, "bigint");
  assert.throws(TypeError, () => { const value: bigint = i === 0 ? 0n : i === 1 ? -0n : i === 2 ? 1n : i === 3 ? -1n : i === 4 ? 2n : i === 5 ? -2n : i === 6 ? 3n : i === 7 ? -3n : i === 8 ? 7n : i === 9 ? -7n : i === 10 ? 9223372036854775807n : i === 11 ? -9223372036854775808n : i === 12 ? 18446744073709551616n : i === 13 ? 170141183460469231731687303715884105727n : i === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n; attempts++; JSON.stringify(value); });
  assert.sameValue(value, expected[i]); assert.sameValue(typeof value, "bigint");
  const plain: number = i; const encoded = JSON.stringify({ value: plain });
  assert.sameValue(encoded, expectedText[i]); assert.sameValue(typeof encoded, "string");
}
assert.sameValue(attempts, 16);
