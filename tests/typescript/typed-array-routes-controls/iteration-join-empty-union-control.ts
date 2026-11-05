/*---
description: "Join emits no separator for empty or singleton arrays. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-bigint, ts-unions, ts-narrowing, ts-tuples, ts-strings]
---*/

function localInt8Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function localBigInt64Array(values: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function localJoin(data: readonly (number | bigint)[], separator: string = ","): string { let result = ""; for (let i = 0; i < data.length; i++) result += (i === 0 ? "" : separator) + String(data[i]); return result; }
// Join emits no separator for empty or singleton arrays. Route: a discriminant selecting numeric or bigint input.
// Node prints iteration-join-empty-union:ok.
type Numbers = number[]; type Bigints = bigint[];
type JoinInput = { kind: "number"; data: Numbers } | { kind: "bigint"; data: Bigints };
function joinInput(input: JoinInput): string { if (input.kind === "number") return localJoin(input.data, "|"); return localJoin(input.data, "/"); }
const rows: readonly [JoinInput, string][] = [
  [{ kind: "number", data: localInt8Array([]) }, ""], [{ kind: "bigint", data: localBigInt64Array([]) }, ""],
  [{ kind: "number", data: localInt8Array([-5]) }, "-5"], [{ kind: "bigint", data: localBigInt64Array([-1n]) }, "-1"]
];
for (const [input, expected] of rows) assert.sameValue(joinInput(input), expected);
console.log("iteration-join-empty-union:ok");
