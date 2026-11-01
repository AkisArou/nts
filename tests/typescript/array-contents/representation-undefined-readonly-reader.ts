/*---
description: Stored undefined elements retain own-slot presence through a readonly unknown view of undefined storage.
features: [ts-array-contents, ts-array-representation, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-unknown, ts-null-undefined]
---*/
// Concrete writes cross a wider reader; node keeps exact values, runtime kinds and slot presence.
function check(count: number): void {
  const values: undefined[] = [];
  const reader: readonly unknown[] = values;
  for (let i = 0; i < count; i++) values.push(undefined);
  assert.sameValue(reader.length, count);
  for (let i = 0; i < count; i++) {
    assert.sameValue(reader[i], undefined); assert.sameValue(typeof reader[i], "undefined");
    assert.sameValue(Object.hasOwn(reader, i), true); assert.sameValue(i in reader, true);
  }
  assert.sameValue(reader[count], undefined); assert.sameValue(typeof reader[count], "undefined");
  assert.sameValue(Object.hasOwn(reader, count), false); assert.sameValue(count in reader, false);
}
for (const count of [1, 2, 5]) check(count);
