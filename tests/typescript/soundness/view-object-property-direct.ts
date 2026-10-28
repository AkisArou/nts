/*---
description: A readonly numeric object property preserves an aliased string through a direct read.
features: [ts-unsound-covariant-view, ts-objects, ts-typeof-operator, ts-conversions, ts-structural-typing, ts-readonly]
---*/
// TypeScript accepts the readonly number property as a mutable unknown
// property, allowing the alias to store a string. Node reads that string
// through the original narrow readonly reference.
const cell: { readonly value: number } = { value: 2 };
const writer: { value: unknown } = cell;
writer.value = "7";
assert.sameValue(typeof cell.value, "string");
assert.sameValue(String(cell.value + 1), "71");
assert.sameValue(cell.value === 7, false);
