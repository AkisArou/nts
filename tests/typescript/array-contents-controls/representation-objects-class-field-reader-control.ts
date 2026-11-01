/*---
description: Control for representation-objects-class-field-reader; writer and reader use one declared array type.
features: [ts-array-contents, ts-array-representation, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-object-type, ts-class, ts-class-fields, ts-instanceof, ts-narrowing, ts-numbers]
---*/
// Only reader declarations change; inputs, writes, reads and assertions are identical.
class ArrayContentsRecord {
  value: number;
  constructor(value: number) { this.value = value; }
}
class ArrayContentsRecordView {
  values: ArrayContentsRecord[];
  constructor(values: ArrayContentsRecord[]) { this.values = values; }
}
function check(n: number): void {
  const first = new ArrayContentsRecord(n), second = new ArrayContentsRecord(n);
  const values: ArrayContentsRecord[] = [];
  const view = new ArrayContentsRecordView(values);
  values.push(first, second, first); first.value = n + 10;
  assert.sameValue(view.values.length, 3);
  assert.compareArray(view.values, [first, second, first]);
  assert.notSameValue(view.values[0], view.values[1]);
  for (let i = 0; i < view.values.length; i++) {
    const item = view.values[i];
    assert.sameValue(typeof item, "object");
    if (!(item instanceof ArrayContentsRecord)) throw new Test262Error("record required");
    assert.sameValue(item.value, i === 1 ? n : n + 10); assert.sameValue(typeof item.value, "number");
    assert.sameValue(Object.hasOwn(view.values, i), true); assert.sameValue(i in view.values, true);
  }
}
for (const n of [-2, 0, 9]) check(n);
