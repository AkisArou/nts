/*---
description: A mutable numeric class field preserves an aliased string through a numeric return.
features: [ts-unsound-covariant-view, ts-class, ts-class-fields, ts-typeof-operator, ts-conversions, ts-functions, ts-structural-typing, ts-objects]
---*/
// TypeScript treats the mutable number property covariantly, so a wider
// property alias can store a string. Node reads that string through the
// original numeric reference.
class Cell {
  value: number = 2;
}
const cell = new Cell();
const writer: { value: unknown } = cell;
writer.value = "7";
function read(cell: Cell): number {
  return cell.value;
}
const value: number = read(cell);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
