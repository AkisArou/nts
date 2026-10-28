/*---
description: A string written by a bivariant method sink survives destructuring of a numeric tuple slot.
features: [ts-unsound-bivariance, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-objects, ts-functions]
---*/
// TypeScript allows the numeric method sink at an unknown-parameter view,
// so its store contradicts the slot type. Node keeps the actual string.
function inject(sink: { put(value: unknown): void }): void {
  sink.put("7");
}
const values: [number, boolean] = [0, true];
inject({
  put(value: number): void { values[0] = value; }
});
const [value, marker] = values;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
assert.sameValue(marker, true);
