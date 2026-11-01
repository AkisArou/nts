/*---
description: A reused class instance runs toJSON separately for each key and returns ordered records containing that key and its numeric state.
features: [ts-json-routes, ts-json-replacers, ts-class, ts-class-fields, ts-functions, ts-objects, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown]
---*/
// Reuse a class instance at a property and inside an array; node calls toJSON twice and recursively serializes each newly returned record.
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
  const value = new JsonEmitter(n);
  const expected = '{"alpha":{"key":"alpha","payload":' + n + '},"list":[{"key":"0","payload":' + n + '}]}';
  assert.sameValue(JSON.stringify({ alpha: value, list: [value] }), expected);
  assert.compareArray(keys, ["alpha", "0"]); assert.compareArray(values, [n, n]); assert.compareArray(counts, [1, 2]);
  assert.compareArray(holders, [value, value]); assert.sameValue(value.calls, 2); assert.sameValue(Object.is(value.value, n), true);
}
