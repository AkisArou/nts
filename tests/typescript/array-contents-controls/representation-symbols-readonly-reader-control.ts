/*---
description: Control for representation-symbols-readonly-reader; writer and reader use one declared array type.
features: [ts-array-contents, ts-array-representation, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-unknown, ts-symbols, ts-strings]
---*/
// Only reader declarations change; inputs, writes, reads and assertions are identical.
function check(label: string): void {
  const first = Symbol(label), second = Symbol(label), registered = Symbol.for("array:" + label);
  const values: symbol[] = [];
  const reader: symbol[] = values;
  values.push(first, second, first, registered);
  assert.sameValue(reader.length, 4);
  assert.compareArray(reader, [first, second, first, registered]);
  assert.notSameValue(reader[0], reader[1]); assert.sameValue(reader[0], reader[2]);
  for (let i = 0; i < reader.length; i++) {
    assert.sameValue(typeof reader[i], "symbol");
    assert.sameValue(Object.hasOwn(reader, i), true); assert.sameValue(i in reader, true);
  }
}
for (const label of ["", "key", "another"]) check(label);
