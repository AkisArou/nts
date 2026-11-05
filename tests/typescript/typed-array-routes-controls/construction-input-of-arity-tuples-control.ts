/*---
description: "Of treats every argument as an element and accepts zero, one or several arguments. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-functions, ts-iteration, ts-readonly, ts-numbers, ts-tuples, ts-destructuring, ts-spread]
---*/

function localInteger(value: number, width: number, signed: boolean): number { if (!Number.isFinite(value)) return 0; const modulus = 2 ** width, n = (Math.trunc(value) % modulus + modulus) % modulus; return signed && n >= modulus / 2 ? n - modulus : n; }
function localOfUint16Array(...values: number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = localInteger(values[i], 16, false); return result; }
// Of treats every argument as an element and accepts zero, one or several arguments. Route: readonly input and expected-value tuples.
// Node prints construction-input-of-arity-tuples:ok.
const rows: readonly [readonly number[], readonly number[]][] = [[[], []], [[3], [3]], [[0], [0]], [[65543, -1, 2], [7, 65535, 2]]];
for (const [values, expected] of rows) {
  const result = localOfUint16Array(...values), actual: number[] = [];
  for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.sameValue(result.length, values.length); assert.compareArray(actual, expected);
}
console.log("construction-input-of-arity-tuples:ok");
