/*---
description: "Join emits no separator for empty or singleton arrays."
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-bigint, ts-unions, ts-narrowing, ts-tuples, ts-strings]
---*/

// Join emits no separator for empty or singleton arrays. Route: a discriminant selecting numeric or bigint input.
// Node prints iteration-join-empty-union:ok.
type Numbers = Int8Array; type Bigints = BigInt64Array;
type JoinInput = { kind: "number"; data: Numbers } | { kind: "bigint"; data: Bigints };
function joinInput(input: JoinInput): string { if (input.kind === "number") return input.data.join("|"); return input.data.join("/"); }
const rows: readonly [JoinInput, string][] = [
  [{ kind: "number", data: new Int8Array([]) }, ""], [{ kind: "bigint", data: new BigInt64Array([]) }, ""],
  [{ kind: "number", data: new Int8Array([-5]) }, "-5"], [{ kind: "bigint", data: new BigInt64Array([-1n]) }, "-1"]
];
for (const [input, expected] of rows) assert.sameValue(joinInput(input), expected);
console.log("iteration-join-empty-union:ok");
