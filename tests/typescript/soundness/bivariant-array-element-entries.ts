/*---
description: A string written by a bivariant method sink survives entries iteration of a numeric array slot.
features: [ts-unsound-bivariance, ts-arrays, ts-typeof-operator, ts-conversions, ts-iteration, ts-tuples, ts-objects, ts-functions]
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
const seen: string[] = [];
for (const entry of values.entries()) {
  seen.push(entry[0] + ":" + typeof entry[1] + ":" + String(entry[1] + 1));
}
assert.compareArray(seen, ["0:number:3", "1:string:71"]);
