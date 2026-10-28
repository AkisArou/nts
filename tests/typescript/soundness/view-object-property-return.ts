/*---
description: A mutable numeric object property preserves an aliased string through a numeric return.
features: [ts-unsound-covariant-view, ts-objects, ts-typeof-operator, ts-conversions, ts-functions, ts-structural-typing]
---*/
// TypeScript treats the mutable number property covariantly, so a wider
// property alias can store a string. Node reads that string through the
// original numeric reference.
const cell: { value: number } = { value: 2 };
const writer: { value: unknown } = cell;
writer.value = "7";
function read(cell: { value: number }): number {
  return cell.value;
}
const value: number = read(cell);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
