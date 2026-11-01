/*---
description: Control for stringify-union-array-null-substitution; serialize the same values from a plain literal.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-unions, ts-arrays, ts-objects, ts-null-undefined, ts-function-types, ts-arrow-functions, ts-symbols, ts-numbers]
---*/
// Only the declared holder or class construction changes; values, operations and assertions remain identical.
type JsonOmittedElement = number | undefined | (() => number) | symbol;
interface JsonArrayRecord { values: JsonOmittedElement[]; }
for (const n of [-2, 0, 7]) {
  let calls = 0;
  const value = { values: [n, undefined, () => { calls++; return n; }, Symbol("value"), -0, NaN] };
  assert.sameValue(JSON.stringify(value), `{"values":[${n},null,null,null,0,null]}`);
  assert.sameValue(value.values.length, 6);
  assert.sameValue(calls, 0);
}
