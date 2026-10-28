/*---
description: A wider alias with literal-key private access pollutes the numeric class field returned by a getter.
features: [ts-unsound-private, ts-class, ts-class-fields, ts-private-keyword, ts-generics, ts-unsound-covariant-view, ts-accessors, ts-typeof-operator, ts-conversions]
---*/
// TypeScript permits a covariant generic alias and literal-key private access.
// Its string write breaks the numeric getter's claim; node returns the string.
class Cell<T> {
  private field: T;
  constructor(value: T) { this.field = value; }
  get value(): T { return this.field; }
}
const cell = new Cell<number>(1);
const wide: Cell<unknown> = cell;
wide["field"] = "7";
const value: number = cell.value;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
