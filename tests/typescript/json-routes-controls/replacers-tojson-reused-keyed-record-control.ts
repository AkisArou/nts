/*---
description: Control for replacers-tojson-reused-keyed-record; use a plain literal at the tested route.
features: [ts-json-routes, ts-json-replacers, ts-class, ts-class-fields, ts-functions, ts-objects, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown]
---*/
// Construct a plain object literal with the same fields and toJSON body in place of the class instance.
const keys: string[] = [], values: number[] = [], counts: number[] = [], holders: unknown[] = [];
class JsonEmitter {
  value: number; calls: number = 0;
  constructor(value: number) { this.value = value; }
  toJSON(key: string): { key: string; payload: number } {
    this.calls++; keys.push(key); values.push(this.value); counts.push(this.calls); holders.push(this);
    return { key, payload: this.value };
  }
}
for (const n of [-2, 0, 3]) {
  keys.length = 0; values.length = 0; counts.length = 0; holders.length = 0;
  const value = { value: n, calls: 0, toJSON(key: string): { key: string; payload: number } {
    this.calls++; keys.push(key); values.push(this.value); counts.push(this.calls); holders.push(this);
    return { key, payload: this.value };
  } };
  const expected = '{"alpha":{"key":"alpha","payload":' + n + '},"list":[{"key":"0","payload":' + n + '}]}';
  assert.sameValue(JSON.stringify({ alpha: value, list: [value] }), expected);
  assert.compareArray(keys, ["alpha", "0"]); assert.compareArray(values, [n, n]); assert.compareArray(counts, [1, 2]);
  assert.compareArray(holders, [value, value]); assert.sameValue(value.calls, 2); assert.sameValue(Object.is(value.value, n), true);
}
