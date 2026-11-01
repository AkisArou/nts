/*---
description: Control for stringify-class-self-cycle; serialize the same values from a plain literal.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-objects, ts-unknown, ts-errors, ts-arrow-functions, ts-numbers]
---*/
// Only the declared holder or class construction changes; values, operations and assertions remain identical.
class JsonCycleRecord {
  label: number;
  next: unknown;
  constructor(n: number) { this.label = n; this.next = undefined; }
}
for (const n of [-2, 0, 7]) {
  const value: { label: number; next: unknown } = { label: n, next: undefined };
  value.next = value;
  assert.sameValue(value.next, value);
  assert.compareArray(Object.keys(value), ["label", "next"]);
  assert.throws(TypeError, () => JSON.stringify(value));
}
