/*---
description: Control for replacers-tojson-undefined-positions; use a plain literal at the tested route.
features: [ts-json-routes, ts-json-replacers, ts-class, ts-class-fields, ts-functions, ts-objects, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-null-undefined]
---*/
// Construct a plain object literal with the same field and toJSON body in place of the class instance.
const keys: string[] = [], values: number[] = [], holders: unknown[] = [];
class JsonDropper {
  value: number;
  constructor(value: number) { this.value = value; }
  toJSON(key: string): undefined { keys.push(key); values.push(this.value); holders.push(this); return undefined; }
}
for (const n of [-2, 0, 3]) {
  keys.length = 0; values.length = 0; holders.length = 0;
  const value = { value: n, toJSON(key: string): undefined { keys.push(key); values.push(this.value); holders.push(this); return undefined; } };
  assert.sameValue(JSON.stringify({ item: value, keep: n }), '{"keep":' + n + '}');
  assert.sameValue(JSON.stringify([value, n]), '[null,' + n + ']');
  assert.sameValue(JSON.stringify(value), undefined);
  assert.compareArray(keys, ["item", "0", ""]); assert.compareArray(values, [n, n, n]);
  assert.compareArray(holders, [value, value, value]); assert.sameValue(Object.is(value.value, n), true);
}
