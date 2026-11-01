/*---
description: A numeric array in a declared class field serializes signed zero and every nonfinite element in place.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-arrays, ts-objects, ts-numbers]
---*/
// Serialize a class holding number[]; node preserves the array length and maps its signed zero and nonfinite values to JSON numbers or null.
class JsonNumberList {
  values: number[];
  constructor(n: number) { this.values = [n, -0, NaN, Infinity, -Infinity]; }
}
for (const n of [-2, 0, 7.5]) {
  const value: JsonNumberList = new JsonNumberList(n);
  assert.sameValue(JSON.stringify(value), `{"values":[${n},0,null,null,null]}`);
  assert.sameValue(value.values.length, 5);
  assert.sameValue(Object.is(value.values[1], -0), true);
}
