/*---
description: A covariant writable field view pollutes the numeric class field returned by a getter.
features: [ts-unsound-covariant-view, ts-class, ts-class-fields, ts-typeof-operator, ts-conversions, ts-structural-typing, ts-accessors, ts-objects]
---*/
// TypeScript permits the numeric field through a writable unknown field view.
// A string write breaks the getter's number claim; node returns the string.
class Cell {
  field: number = 1;
  get value(): number { return this.field; }
}
const cell = new Cell();
const wide: { field: unknown } = cell;
wide.field = "7";
const value: number = cell.value;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
