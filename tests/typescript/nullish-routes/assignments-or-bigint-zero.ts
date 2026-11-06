/*---
description: "OR assignment replaces zero bigint. Route: declared variable type"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// OR assignment replaces zero bigint. Route: declared variable type. Node prints assignments-or-bigint-zero:ok.
let value: bigint | null = 0n;
const log: string[] = [];
function next(): bigint | null { log.push("rhs"); return 5n; }
const result = (value ||= next());
assert.sameValue(result, 5n);
assert.sameValue(value, 5n);
assert.compareArray(log, ["rhs"]);
console.log("assignments-or-bigint-zero:ok");
