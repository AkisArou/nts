/*---
description: A function returning a number preserves a string stored in a numeric class field.
features: [ts-unsound-bivariance, ts-class, ts-class-fields, ts-typeof-operator, ts-conversions, ts-functions, ts-objects]
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
function read(cell: Cell): number {
  return cell.value;
}
const value: number = read(cell);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
