/*---
description: A string written by a bivariant method sink survives a map callback of a numeric array slot.
features: [ts-unsound-bivariance, ts-arrays, ts-typeof-operator, ts-conversions, ts-functions, ts-objects]
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
const seen = values.map((value: number) => typeof value + ":" + String(value + 1));
assert.compareArray(seen, ["number:3", "string:71"]);
