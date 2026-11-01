/*---
description: Control for stringify-class-numeric-array; serialize the same values from a plain literal.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-arrays, ts-objects, ts-numbers]
---*/
// Only the declared holder or class construction changes; values, operations and assertions remain identical.
class JsonNumberList {
  values: number[];
  constructor(n: number) { this.values = [n, -0, NaN, Infinity, -Infinity]; }
}
for (const n of [-2, 0, 7.5]) {
  const value = { values: [n, -0, NaN, Infinity, -Infinity] };
  assert.sameValue(JSON.stringify(value), `{"values":[${n},0,null,null,null]}`);
  assert.sameValue(value.values.length, 5);
  assert.sameValue(Object.is(value.values[1], -0), true);
}
