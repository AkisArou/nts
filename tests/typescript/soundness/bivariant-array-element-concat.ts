/*---
description: A string written by a bivariant method sink survives a concat copy of a numeric array slot.
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
const copy: number[] = values.concat([3]);
assert.sameValue(typeof copy[1], "string");
assert.sameValue(String(copy[1] + 1), "71");
assert.sameValue(JSON.stringify(copy), '[2,"7",3]');
