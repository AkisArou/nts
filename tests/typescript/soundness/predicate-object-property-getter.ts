/*---
description: A lying type predicate pollutes the numeric object property returned by a getter.
features: [ts-unsound-predicate, ts-objects, ts-typeof-operator, ts-conversions, ts-type-guards, ts-narrowing, ts-unknown, ts-accessors, ts-functions]
---*/
// TypeScript trusts this lying predicate and permits a string in the number field.
// The getter retains its number return type; node returns the actual string.
const cell = { field: 1, get value(): number { return this.field; } };
function isNumber(value: unknown): value is number { return true; }
const incoming: unknown = "7";
if (!isNumber(incoming)) throw new Test262Error("predicate refused");
cell.field = incoming;
const value: number = cell.value;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
