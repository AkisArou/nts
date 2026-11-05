/*---
description: "Join uses commas by default and formats zero signs, NaN and infinities as specified. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-readonly, ts-numbers, ts-tuples, ts-destructuring, ts-strings]
---*/

function localFloat64Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function localJoin(data: number[], separator: string = ","): string { let result = ""; for (let i = 0; i < data.length; i++) result += (i === 0 ? "" : separator) + String(data[i]); return result; }
// Join uses commas by default and formats zero signs, NaN and infinities as specified. Route: readonly tuples carrying inputs and expected text.
// Node prints iteration-join-float-readonly:ok.
const rows: readonly [readonly number[], string][] = [[[-0, NaN, 1.5], "0,NaN,1.5"], [[Infinity, -Infinity, 0], "Infinity,-Infinity,0"], [[], ""]];
for (const [values, expected] of rows) {
  const data = localFloat64Array(values);
  assert.sameValue(localJoin(data), expected); assert.sameValue(localJoin(data, undefined), expected);
}
console.log("iteration-join-float-readonly:ok");
