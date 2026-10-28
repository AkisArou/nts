/*---
description: Explicit generic widening leaves a string in a numeric class field through a numeric return.
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
function read(cell: Cell): number {
  return cell.value;
}
const value: number = read(cell);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
