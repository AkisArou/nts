/*---
description: A string written by a bivariant method sink survives a forEach callback of a numeric tuple slot.
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
const seen: string[] = [];
values.forEach((value: number | boolean) => {
  if (typeof value === "boolean") seen.push("boolean:" + String(value));
  else seen.push(typeof value + ":" + String(value + 1));
});
assert.compareArray(seen, ["string:71", "boolean:true"]);
