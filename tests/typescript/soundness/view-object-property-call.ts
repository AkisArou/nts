/*---
description: A readonly numeric object property preserves an aliased string through a numeric parameter.
features: [ts-unsound-covariant-view, ts-objects, ts-typeof-operator, ts-conversions, ts-functions, ts-structural-typing, ts-readonly]
---*/
// TypeScript accepts the readonly number property as a mutable unknown
// property, allowing the alias to store a string. Node reads that string
// through the original narrow readonly reference.
const cell: { readonly value: number } = { value: 2 };
const writer: { value: unknown } = cell;
writer.value = "7";
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
assert.sameValue(describe(cell.value), "string:71");
