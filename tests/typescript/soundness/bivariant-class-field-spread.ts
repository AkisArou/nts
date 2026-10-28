/*---
description: Spreading an object copies the string stored by a bivariant sink in its numeric class field.
features: [ts-unsound-bivariance, ts-class, ts-class-fields, ts-typeof-operator, ts-conversions, ts-spread, ts-objects, ts-functions]
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
const copied = { ...cell };
assert.sameValue(typeof copied.value, "string");
assert.sameValue(String(copied.value + 1), "71");
assert.sameValue(JSON.stringify(copied), '{"value":"7"}');
