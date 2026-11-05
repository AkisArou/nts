/*---
description: "Join uses commas by default and formats zero signs, NaN and infinities as specified."
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-readonly, ts-numbers, ts-tuples, ts-destructuring, ts-strings]
---*/

// Join uses commas by default and formats zero signs, NaN and infinities as specified. Route: readonly tuples carrying inputs and expected text.
// Node prints iteration-join-float-readonly:ok.
const rows: readonly [readonly number[], string][] = [[[-0, NaN, 1.5], "0,NaN,1.5"], [[Infinity, -Infinity, 0], "Infinity,-Infinity,0"], [[], ""]];
for (const [values, expected] of rows) {
  const data = new Float64Array(values);
  assert.sameValue(data.join(), expected); assert.sameValue(data.join(undefined), expected);
}
console.log("iteration-join-float-readonly:ok");
