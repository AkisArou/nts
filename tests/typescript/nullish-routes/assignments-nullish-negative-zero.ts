/*---
description: "Nullish assignment preserves negative zero. Route: declared variable type"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// Nullish assignment preserves negative zero. Route: declared variable type. Node prints assignments-nullish-negative-zero:ok.
let value: number | undefined = -0;
const log: string[] = [];
function next(): number | undefined { log.push("rhs"); return 4; }
const result = (value ??= next());
assert.sameValue(result, -0);
assert.sameValue(value, -0);
assert.compareArray(log, []);
console.log("assignments-nullish-negative-zero:ok");
