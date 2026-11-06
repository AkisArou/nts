/*---
description: "AND assignment retains NaN. Route: declared variable type (control)"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// AND assignment retains NaN. Route: declared variable type. Node prints assignments-and-nan-number:ok.
let value: number | undefined = NaN;
const log: string[] = [];
function next(): number | undefined { log.push("rhs"); return 9; }
const saved = value; let result: number | undefined = saved;
if (saved) { const nextValue = next(); value = nextValue; result = nextValue; }
assert.sameValue(result, NaN);
assert.sameValue(value, NaN);
assert.compareArray(log, []);
console.log("assignments-and-nan-number:ok");
