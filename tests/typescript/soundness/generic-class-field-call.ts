/*---
description: Explicit generic widening leaves a string in a numeric class field through a numeric parameter.
features: [ts-unsound-generic-widening, ts-class, ts-class-fields, ts-typeof-operator, ts-conversions, ts-functions, ts-generics, ts-objects]
---*/
// TypeScript permits the numeric field in an explicit unknown instantiation.
// The generic writer stores a string despite that field type; node keeps it.
function write<T>(cell: { value: T }, value: T): void {
  cell.value = value;
}
class Cell {
  value: number = 2;
}
const cell = new Cell();
write<unknown>(cell, "7");
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
assert.sameValue(describe(cell.value), "string:71");
