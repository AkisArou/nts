/*---
description: "Nullish assignment preserves zero bigint. Route: declared variable type (control)"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// Nullish assignment preserves zero bigint. Route: declared variable type. Node prints assignments-nullish-bigint-zero:ok.
let value: bigint | null = 0n;
const log: string[] = [];
function next(): bigint | null { log.push("rhs"); return 5n; }
const saved = value; let result: bigint | null = saved;
if (saved === null || saved === undefined) { const nextValue = next(); value = nextValue; result = nextValue; }
assert.sameValue(result, 0n);
assert.sameValue(value, 0n);
assert.compareArray(log, []);
console.log("assignments-nullish-bigint-zero:ok");
