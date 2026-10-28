/*---
description: A string written by a bivariant method sink survives a filter result of a numeric array slot.
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
const kept: number[] = values.filter((value: number) => value !== 2);
assert.sameValue(kept.length, 1);
assert.sameValue(typeof kept[0], "string");
assert.sameValue(String(kept[0] + 1), "71");
assert.sameValue(kept[0] === 7, false);
