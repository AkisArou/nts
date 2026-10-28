/*---
description: A string written by a bivariant method sink survives an indexed read of a numeric tuple slot.
features: [ts-unsound-bivariance, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-objects, ts-functions]
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
assert.sameValue(typeof values[0], "string");
assert.sameValue(String(values[0] + 1), "71");
assert.sameValue(values[0] === 7, false);
assert.sameValue(values[1], true);
