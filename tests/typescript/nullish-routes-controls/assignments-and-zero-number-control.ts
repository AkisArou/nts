/*---
description: "AND assignment retains numeric zero. Route: declared variable type (control)"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// AND assignment retains numeric zero. Route: declared variable type. Node prints assignments-and-zero-number:ok.
let value: number | undefined = 0;
const log: string[] = [];
function next(): number | undefined { log.push("rhs"); return 9; }
const saved = value; let result: number | undefined = saved;
if (saved) { const nextValue = next(); value = nextValue; result = nextValue; }
assert.sameValue(result, 0);
assert.sameValue(value, 0);
assert.compareArray(log, []);
console.log("assignments-and-zero-number:ok");
