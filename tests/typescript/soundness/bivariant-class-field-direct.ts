/*---
description: A bivariant method sink stores a string in a numeric class field read directly.
features: [ts-unsound-bivariance, ts-class, ts-class-fields, ts-typeof-operator, ts-conversions, ts-objects, ts-functions]
---*/
// TypeScript's method-signature bivariance accepts this numeric writer as a
// writer of unknown. It stores a string in a number slot; node keeps the string.
function inject(sink: { put(value: unknown): void }): void {
  sink.put("7");
}
class Cell {
  value: number = 2;
}
const cell = new Cell();
const sink = {
  put(value: number): void { cell.value = value; }
};
inject(sink);
assert.sameValue(typeof cell.value, "string");
assert.sameValue(String(cell.value + 1), "71");
assert.sameValue(cell.value === 7, false);
