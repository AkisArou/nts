/*---
description: A bivariant method sink pollutes the numeric class field returned by a getter.
features: [ts-unsound-bivariance, ts-class, ts-class-fields, ts-typeof-operator, ts-conversions, ts-objects, ts-functions, ts-accessors]
---*/
// TypeScript widens the numeric method by bivariance, letting it write a string.
// The getter still promises number; node returns the actual field unchanged.
class Cell {
  field: number = 1;
  get value(): number { return this.field; }
}
const cell = new Cell();
const narrow: { put(value: number): void } = { put(value) { cell.field = value; } };
const wide: { put(value: unknown): void } = narrow;
wide.put("7");
const value: number = cell.value;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
