/*---
description: A readonly numeric class field preserves an aliased string through a direct read.
features: [ts-unsound-covariant-view, ts-class, ts-class-fields, ts-typeof-operator, ts-conversions, ts-structural-typing, ts-readonly, ts-objects]
---*/
// TypeScript accepts the readonly number property as a mutable unknown
// property, allowing the alias to store a string. Node reads that string
// through the original narrow readonly reference.
class Cell {
  readonly value: number = 2;
}
const cell = new Cell();
const writer: { value: unknown } = cell;
writer.value = "7";
assert.sameValue(typeof cell.value, "string");
assert.sameValue(String(cell.value + 1), "71");
assert.sameValue(cell.value === 7, false);
