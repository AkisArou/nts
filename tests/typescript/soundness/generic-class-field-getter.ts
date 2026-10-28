/*---
description: An explicitly widened generic writer pollutes the numeric class field returned by a getter.
features: [ts-unsound-generic-widening, ts-class, ts-class-fields, ts-typeof-operator, ts-conversions, ts-generics, ts-accessors, ts-functions, ts-objects]
---*/
// TypeScript accepts the numeric field at an explicit unknown instantiation.
// The generic write breaks its type; node's numeric getter returns the string.
class Cell {
  field: number = 1;
  get value(): number { return this.field; }
}
const cell = new Cell();
function set<T>(target: { field: T }, value: T): void { target.field = value; }
set<unknown>(cell, "7");
const value: number = cell.value;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
