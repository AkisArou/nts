/*---
description: "Of treats every argument as an element and accepts zero, one or several arguments."
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-functions, ts-iteration, ts-readonly, ts-numbers, ts-tuples, ts-destructuring, ts-spread]
---*/

// Of treats every argument as an element and accepts zero, one or several arguments. Route: readonly input and expected-value tuples.
// Node prints construction-input-of-arity-tuples:ok.
const rows: readonly [readonly number[], readonly number[]][] = [[[], []], [[3], [3]], [[0], [0]], [[65543, -1, 2], [7, 65535, 2]]];
for (const [values, expected] of rows) {
  const result = Uint16Array.of(...values), actual: number[] = [];
  for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.sameValue(result.length, values.length); assert.compareArray(actual, expected);
}
console.log("construction-input-of-arity-tuples:ok");
