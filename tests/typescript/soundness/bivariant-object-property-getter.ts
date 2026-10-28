/*---
description: A bivariant method sink pollutes the numeric object property returned by a getter.
features: [ts-unsound-bivariance, ts-objects, ts-typeof-operator, ts-conversions, ts-functions, ts-accessors]
---*/
// TypeScript widens the numeric method by bivariance, letting it write a string.
// The getter still promises number; node returns the actual field unchanged.
const cell = { field: 1, get value(): number { return this.field; } };
const narrow: { put(value: number): void } = { put(value) { cell.field = value; } };
const wide: { put(value: unknown): void } = narrow;
wide.put("7");
const value: number = cell.value;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
