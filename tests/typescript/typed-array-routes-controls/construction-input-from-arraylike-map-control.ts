/*---
description: "From reads an array-like source by its declared length and numbered entries. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-functions, ts-iteration, ts-readonly, ts-numbers, ts-map-set, ts-objects, ts-tuples, ts-destructuring, ts-strings, ts-narrowing, ts-errors]
---*/

function localInteger(value: number, width: number, signed: boolean): number { if (!Number.isFinite(value)) return 0; const modulus = 2 ** width, n = (Math.trunc(value) % modulus + modulus) % modulus; return signed && n >= modulus / 2 ? n - modulus : n; }
function localFromUint8Array(values: ArrayLike<number>): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = localInteger(values[i], 8, false); return result; }
// From reads an array-like source by its declared length and numbered entries. Route: array-like records read through a guarded Map.
// Node prints construction-input-from-arraylike-map:ok.
const sources: Map<string, ArrayLike<number>> = new Map<string, ArrayLike<number>>([
  ["pair", { length: 2, 0: 5, 1: 6 }], ["triple", { length: 3, 0: 7, 1: 0, 2: 255 }], ["empty", { length: 0 }]
]);
const rows: readonly [string, readonly number[]][] = [["pair", [5, 6]], ["triple", [7, 0, 255]], ["empty", []]];
for (const [key, expected] of rows) {
  const input = sources.get(key); if (input === undefined) throw new Error("missing input");
  const result = localFromUint8Array(input), actual: number[] = [];
  for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected); assert.sameValue(result.length, input.length);
}
console.log("construction-input-from-arraylike-map:ok");
