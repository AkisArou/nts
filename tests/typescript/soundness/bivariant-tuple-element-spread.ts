/*---
description: A string written by a bivariant method sink survives a spread copy of a numeric tuple slot.
features: [ts-unsound-bivariance, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-iteration, ts-spread, ts-objects, ts-functions, ts-unions, ts-narrowing]
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
const copy = [...values];
const value = copy[0];
if (typeof value === "boolean") throw new Test262Error("numeric slot became boolean");
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
assert.sameValue(JSON.stringify(copy), '["7",true]');
