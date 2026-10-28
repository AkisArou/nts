/*---
description: A lying assertion function pollutes the numeric object property returned by a getter.
features: [ts-unsound-assertion, ts-objects, ts-typeof-operator, ts-conversions, ts-assertion-functions, ts-narrowing, ts-unknown, ts-accessors, ts-functions]
---*/
// TypeScript trusts this empty assertion and allows a string in the number field.
// The getter still promises number; node returns the field's actual string.
const cell = { field: 1, get value(): number { return this.field; } };
function claimNumber(value: unknown): asserts value is number {}
const incoming: unknown = "7";
claimNumber(incoming);
cell.field = incoming;
const value: number = cell.value;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
