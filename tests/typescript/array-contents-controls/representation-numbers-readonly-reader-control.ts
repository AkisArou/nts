/*---
description: Control for representation-numbers-readonly-reader; writer and reader use one declared array type.
features: [ts-array-contents, ts-array-representation, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-unknown, ts-numbers]
---*/
// Only reader declarations change; inputs, writes, reads and assertions are identical.
function check(n: number): void {
  const values: number[] = [];
  const reader: number[] = values;
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
