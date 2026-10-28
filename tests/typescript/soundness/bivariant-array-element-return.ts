/*---
description: A string written by a bivariant method sink survives a numeric return of a numeric array slot.
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
function read(): number {
  return values[1];
}
const value: number = read();
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
