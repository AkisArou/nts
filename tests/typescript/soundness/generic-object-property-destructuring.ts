/*---
description: Explicit generic widening leaves a string in a numeric object property through destructuring.
features: [ts-unsound-generic-widening, ts-objects, ts-typeof-operator, ts-conversions, ts-destructuring, ts-generics, ts-functions]
---*/
// TypeScript permits the numeric field in an explicit unknown instantiation.
// The generic writer stores a string despite that field type; node keeps it.
function write<T>(cell: { value: T }, value: T): void {
  cell.value = value;
}
const cell: { value: number } = { value: 2 };
write<unknown>(cell, "7");
const { value } = cell;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
