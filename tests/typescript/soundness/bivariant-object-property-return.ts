/*---
description: A function returning a number preserves a string stored in a numeric object property.
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
function read(cell: { value: number }): number {
  return cell.value;
}
const value: number = read(cell);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
