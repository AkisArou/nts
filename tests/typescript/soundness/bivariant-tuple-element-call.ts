/*---
description: A string written by a bivariant method sink survives a numeric parameter of a numeric tuple slot.
features: [ts-unsound-bivariance, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-objects]
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
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
assert.sameValue(describe(values[0]), "string:71");
assert.sameValue(values[1], true);
