/*---
description: A bivariant method sink stores a string in a numeric object property read directly.
features: [ts-unsound-bivariance, ts-objects, ts-typeof-operator, ts-conversions, ts-functions]
---*/
// TypeScript's method-signature bivariance accepts this numeric writer as a
// writer of unknown. It stores a string in a number slot; node keeps the string.
function inject(sink: { put(value: unknown): void }): void {
  sink.put("7");
}
const cell: { value: number } = { value: 2 };
const sink = {
  put(value: number): void { cell.value = value; }
};
inject(sink);
assert.sameValue(typeof cell.value, "string");
assert.sameValue(String(cell.value + 1), "71");
assert.sameValue(cell.value === 7, false);
