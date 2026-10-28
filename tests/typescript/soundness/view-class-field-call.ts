/*---
description: A readonly numeric class field preserves an aliased string through a numeric parameter.
features: [ts-unsound-covariant-view, ts-class, ts-class-fields, ts-typeof-operator, ts-conversions, ts-functions, ts-structural-typing, ts-readonly, ts-objects]
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
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
assert.sameValue(describe(cell.value), "string:71");
