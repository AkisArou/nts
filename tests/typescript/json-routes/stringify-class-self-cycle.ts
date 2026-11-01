/*---
description: A self-cycle written into a declared class field throws TypeError during JSON serialization.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-objects, ts-unknown, ts-errors, ts-arrow-functions, ts-numbers]
---*/
// Close a cycle through a class field and stringify the instance; node throws TypeError rather than returning text.
class JsonCycleRecord {
  label: number;
  next: unknown;
  constructor(n: number) { this.label = n; this.next = undefined; }
}
for (const n of [-2, 0, 7]) {
  const value: JsonCycleRecord = new JsonCycleRecord(n);
  value.next = value;
  assert.sameValue(value.next, value);
  assert.compareArray(Object.keys(value), ["label", "next"]);
  assert.throws(TypeError, () => JSON.stringify(value));
}
