/*---
description: Control for representation-null-readonly-reader; writer and reader use one declared array type.
features: [ts-array-contents, ts-array-representation, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-unknown, ts-null-undefined]
---*/
// Only reader declarations change; inputs, writes, reads and assertions are identical.
function check(count: number): void {
  const values: null[] = [];
  const reader: null[] = values;
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
