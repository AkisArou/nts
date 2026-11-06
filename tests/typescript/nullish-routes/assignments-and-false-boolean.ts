/*---
description: "AND assignment retains false. Route: declared variable type"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// AND assignment retains false. Route: declared variable type. Node prints assignments-and-false-boolean:ok.
let value: boolean | undefined = false;
const log: string[] = [];
function next(): boolean | undefined { log.push("rhs"); return true; }
const result = (value &&= next());
assert.sameValue(result, false);
assert.sameValue(value, false);
assert.compareArray(log, []);
console.log("assignments-and-false-boolean:ok");
