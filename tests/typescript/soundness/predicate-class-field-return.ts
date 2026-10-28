/*---
description: A lying predicate leaves a string in a claimed numeric class field through a number-typed return.
features: [ts-unsound-predicate, ts-class, ts-class-fields, ts-typeof-operator, ts-conversions, ts-functions, ts-type-guards, ts-narrowing, ts-unknown, ts-generics]
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
function read(cell: Cell<number>): number {
  return cell.value;
}
const value: number = read(cell);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
