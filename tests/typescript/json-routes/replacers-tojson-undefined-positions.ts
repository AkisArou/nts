/*---
description: A class toJSON returning undefined omits an object property, emits an array null and removes the root result with exact keys and receivers.
features: [ts-json-routes, ts-json-replacers, ts-class, ts-class-fields, ts-functions, ts-objects, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-null-undefined]
---*/
// Serialize the same class instance at a property, index and root; node calls its typed toJSON method with item, 0 and the empty key.
const keys: string[] = [], values: number[] = [], holders: unknown[] = [];
class JsonDropper {
  value: number;
  constructor(value: number) { this.value = value; }
  toJSON(key: string): undefined { keys.push(key); values.push(this.value); holders.push(this); return undefined; }
}
for (const n of [-2, 0, 3]) {
  keys.length = 0; values.length = 0; holders.length = 0;
  const value = new JsonDropper(n);
  assert.sameValue(JSON.stringify({ item: value, keep: n }), '{"keep":' + n + '}');
  assert.sameValue(JSON.stringify([value, n]), '[null,' + n + ']');
  assert.sameValue(JSON.stringify(value), undefined);
  assert.compareArray(keys, ["item", "0", ""]); assert.compareArray(values, [n, n, n]);
  assert.compareArray(holders, [value, value, value]); assert.sameValue(Object.is(value.value, n), true);
}
