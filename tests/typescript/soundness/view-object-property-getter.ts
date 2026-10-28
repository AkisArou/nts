/*---
description: A covariant writable field view pollutes the numeric object property returned by a getter.
features: [ts-unsound-covariant-view, ts-objects, ts-typeof-operator, ts-conversions, ts-structural-typing, ts-accessors]
---*/
// TypeScript permits the numeric field through a writable unknown field view.
// A string write breaks the getter's number claim; node returns the string.
const cell = { field: 1, get value(): number { return this.field; } };
const wide: { field: unknown } = cell;
wide.field = "7";
const value: number = cell.value;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
