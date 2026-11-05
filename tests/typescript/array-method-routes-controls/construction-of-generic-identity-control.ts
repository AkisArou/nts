/*---
description: "Array.of preserves repeated generic values and references without interpreting their contents as a length. (control)"
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints, ts-unions, ts-objects]
---*/

function localOf<T>(...values: T[]): T[] {
  const result: T[] = [];
  for (let index = 0; index < values.length; index++) result[index] = values[index];
  return result;
}
// Array.of preserves repeated generic values and references without interpreting their contents as a length. Route: a constrained helper at number and record type arguments. Node prints construction-of-generic-identity:ok.
function inspect<T extends number | { id: number }>(first: T, second: T): void {
  const result = localOf<T>(first, second, first, second), empty = localOf<T>();
  assert.compareArray(result, [first, second, first, second]); assert.compareArray(empty, []);
  assert.sameValue(result[0] === first, true); assert.sameValue(result[2] === first, true);
  assert.sameValue(Object.is(result[0], first), true); assert.sameValue(Object.is(result[1], second), true);
}
inspect<number>(-0, NaN);
const first = { id: 1 }, second = { id: 2 };
inspect<{ id: number }>(first, second);
console.log("construction-of-generic-identity:ok");
