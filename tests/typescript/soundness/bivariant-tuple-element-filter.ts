/*---
description: A string written by a bivariant method sink survives a filter result of a numeric tuple slot.
features: [ts-unsound-bivariance, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-objects, ts-unions, ts-narrowing]
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
const kept = values.filter((value: number | boolean): boolean => typeof value !== "boolean");
assert.sameValue(kept.length, 1);
const value = kept[0];
if (typeof value === "boolean") throw new Test262Error("filter kept the marker");
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
