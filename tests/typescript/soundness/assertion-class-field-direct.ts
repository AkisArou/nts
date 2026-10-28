/*---
description: A lying assertion function leaves a string in a claimed numeric class field through a direct read.
features: [ts-unsound-assertion, ts-class, ts-class-fields, ts-typeof-operator, ts-conversions, ts-assertion-functions, ts-narrowing, ts-unknown, ts-generics]
---*/
// TypeScript trusts the lying assertion function for this whole state,
// although a claimed numeric member is a string. Node preserves the actual string.
class Cell<T> {
  value: T;
  constructor(value: T) { this.value = value; }
}
function assertNumberCell(value: unknown): asserts value is Cell<number> {}
const cell: unknown = new Cell<string>("7");
assertNumberCell(cell);
assert.sameValue(typeof cell.value, "string");
assert.sameValue(String(cell.value + 1), "71");
assert.sameValue(cell.value === 7, false);
