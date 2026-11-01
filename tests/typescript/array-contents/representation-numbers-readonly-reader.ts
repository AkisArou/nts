/*---
description: A readonly unknown-element reader preserves signed zero, NaN, wide integers and fractions written to number storage.
features: [ts-array-contents, ts-array-representation, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-unknown, ts-numbers]
---*/
// Concrete writes cross a wider reader; node keeps exact values, runtime kinds and slot presence.
function check(n: number): void {
  const values: number[] = [];
  const reader: readonly unknown[] = values;
  values.push(n, -0, NaN, 2147483649, -2147483649, 9007199254740994, -9007199254740994, n + 0.25);
  assert.sameValue(reader.length, 8);
  assert.compareArray(reader, [n, -0, NaN, 2147483649, -2147483649, 9007199254740994, -9007199254740994, n + 0.25]);
  assert.sameValue(reader[1], -0); assert.notSameValue(reader[1], 0);
  assert.sameValue(reader[2], NaN);
  for (let i = 0; i < reader.length; i++) {
    assert.sameValue(typeof reader[i], "number");
    assert.sameValue(Object.hasOwn(reader, i), true); assert.sameValue(i in reader, true);
  }
}
for (const n of [-3, 0, 7]) check(n);
