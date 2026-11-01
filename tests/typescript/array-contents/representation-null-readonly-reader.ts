/*---
description: Null elements remain present null values through a readonly unknown reader of concrete null storage.
features: [ts-array-contents, ts-array-representation, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-unknown, ts-null-undefined]
---*/
// Concrete writes cross a wider reader; node keeps exact values, runtime kinds and slot presence.
function check(count: number): void {
  const values: null[] = [];
  const reader: readonly unknown[] = values;
  for (let i = 0; i < count; i++) values.push(null);
  assert.sameValue(reader.length, count);
  for (let i = 0; i < count; i++) {
    assert.sameValue(reader[i], null); assert.sameValue(typeof reader[i], "object");
    assert.sameValue(Object.hasOwn(reader, i), true); assert.sameValue(i in reader, true);
  }
  assert.sameValue(reader[count], undefined); assert.sameValue(typeof reader[count], "undefined");
  assert.sameValue(Object.hasOwn(reader, count), false); assert.sameValue(count in reader, false);
}
for (const count of [1, 3, 6]) check(count);
