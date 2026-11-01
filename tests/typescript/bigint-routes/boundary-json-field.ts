/*---
description: A number-or-bigint field makes JSON object serialization throw only while the field holds a bigint.
features: [ts-bigint-route-boundaries, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator, ts-interfaces, ts-objects, ts-unions, ts-numbers, ts-strings, ts-errors, ts-arrow-functions, ts-functions, ts-json-stringify]
---*/
// JSON.stringify traverses a number | bigint field at sixteen magnitudes; node throws TypeError for bigint and serializes each later number write.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
interface BoundaryJsonField { value: number | bigint; }
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const expectedText: string[] = ["{\"value\":0}", "{\"value\":1}", "{\"value\":2}", "{\"value\":3}", "{\"value\":4}", "{\"value\":5}", "{\"value\":6}", "{\"value\":7}", "{\"value\":8}", "{\"value\":9}", "{\"value\":10}", "{\"value\":11}", "{\"value\":12}", "{\"value\":13}", "{\"value\":14}", "{\"value\":15}"];
let attempts = 0;
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const holder: BoundaryJsonField = { value: inputs[i] };
  assert.sameValue(holder.value, expected[i]); assert.sameValue(typeof holder.value, "bigint");
  assert.throws(TypeError, () => { attempts++; JSON.stringify(holder); });
  assert.sameValue(holder.value, expected[i]); assert.sameValue(typeof holder.value, "bigint");
  holder.value = i; const encoded = JSON.stringify(holder);
  assert.sameValue(encoded, expectedText[i]); assert.sameValue(typeof encoded, "string");
}
assert.sameValue(attempts, 16);
