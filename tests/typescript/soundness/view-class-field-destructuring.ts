/*---
description: A mutable numeric class field preserves an aliased string through destructuring.
features: [ts-unsound-covariant-view, ts-class, ts-class-fields, ts-typeof-operator, ts-conversions, ts-destructuring, ts-structural-typing, ts-objects]
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
const { value } = cell;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
