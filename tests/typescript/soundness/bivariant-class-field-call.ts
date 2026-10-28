/*---
description: A string stored in a numeric class field reaches a number parameter unchanged.
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
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
assert.sameValue(describe(cell.value), "string:71");
