/*---
description: A lying predicate leaves a string in a claimed numeric class field through a direct read.
features: [ts-unsound-predicate, ts-class, ts-class-fields, ts-typeof-operator, ts-conversions, ts-type-guards, ts-narrowing, ts-unknown, ts-generics]
---*/
// TypeScript trusts the lying predicate for this whole state,
// although a claimed numeric member is a string. Node preserves the actual string.
class Cell<T> {
  value: T;
  constructor(value: T) { this.value = value; }
}
function isNumberCell(value: unknown): value is Cell<number> {
  return true;
}
const cell: unknown = new Cell<string>("7");
if (!isNumberCell(cell)) throw new Test262Error("predicate rejected the fixture");
assert.sameValue(typeof cell.value, "string");
assert.sameValue(String(cell.value + 1), "71");
assert.sameValue(cell.value === 7, false);
