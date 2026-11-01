/*---
description: An interface array of union elements replaces undefined, functions and symbols with null without losing their positions.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-unions, ts-arrays, ts-objects, ts-null-undefined, ts-function-types, ts-arrow-functions, ts-symbols, ts-numbers]
---*/
// Serialize a declared union-element array in an interface field; node keeps every position and substitutes null for unsupported elements.
type JsonOmittedElement = number | undefined | (() => number) | symbol;
interface JsonArrayRecord { values: JsonOmittedElement[]; }
for (const n of [-2, 0, 7]) {
  let calls = 0;
  const value: JsonArrayRecord = { values: [n, undefined, () => { calls++; return n; }, Symbol("value"), -0, NaN] };
  assert.sameValue(JSON.stringify(value), `{"values":[${n},null,null,null,0,null]}`);
  assert.sameValue(value.values.length, 6);
  assert.sameValue(calls, 0);
}
