/*---
description: A string written by a bivariant method sink survives entries iteration of a numeric tuple slot.
features: [ts-unsound-bivariance, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-iteration, ts-objects, ts-functions, ts-unions, ts-narrowing]
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
const seen: string[] = [];
for (const entry of values.entries()) {
  const value = entry[1];
  const text = typeof value === "boolean" ? "boolean:" + String(value) : typeof value + ":" + String(value + 1);
  seen.push(entry[0] + ":" + text);
}
assert.compareArray(seen, ["0:string:71", "1:boolean:true"]);
