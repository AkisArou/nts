/*---
description: A string written by a bivariant method sink survives an indexed read of a numeric array slot.
features: [ts-unsound-bivariance, ts-arrays, ts-typeof-operator, ts-conversions, ts-objects, ts-functions]
---*/
// TypeScript allows the numeric method sink at an unknown-parameter view,
// so its store contradicts the slot type. Node keeps the actual string.
function inject(sink: { put(value: unknown): void }): void {
  sink.put("7");
}
const values: number[] = [2, 0];
inject({
  put(value: number): void { values[1] = value; }
});
assert.sameValue(values.length, 2);
assert.sameValue(typeof values[1], "string");
assert.sameValue(String(values[1] + 1), "71");
assert.sameValue(values[1] === 7, false);
assert.sameValue(values[0] + 1, 3);
