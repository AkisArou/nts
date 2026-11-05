/*---
description: "Array.of treats a sole number as an element and returns fresh empty, singleton and longer arrays. (control)"
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-readonly, ts-spread]
---*/

function localOf<T>(...values: T[]): T[] {
  const result: T[] = [];
  for (let index = 0; index < values.length; index++) result[index] = values[index];
  return result;
}
// Array.of treats a sole number as an element and returns fresh empty, singleton and longer arrays. Route: a readonly array of readonly argument lists. Node prints construction-of-readonly-arguments:ok.
function create(values: readonly number[]): number[] { return localOf(...values); }
const sources: readonly (readonly number[])[] = [[], [7], [0, 2, 9], [-0, NaN, 3]];
for (const values of sources) {
  const result = create(values), repeated = create(values);
  assert.compareArray(result, values); assert.sameValue(result === values, false);
  assert.sameValue(result === repeated, false);
  for (let index = 0; index < values.length; index++) assert.sameValue(Object.is(result[index], values[index]), true);
}
console.log("construction-of-readonly-arguments:ok");
