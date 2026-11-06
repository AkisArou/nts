/*---
description: "OR assignment replaces false boolean. Route: declared variable type (control)"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// OR assignment replaces false boolean. Route: declared variable type. Node prints assignments-or-false-boolean:ok.
let value: boolean | undefined = false;
const log: string[] = [];
function next(): boolean | undefined { log.push("rhs"); return true; }
const saved = value; let result: boolean | undefined = saved;
if (!saved) { const nextValue = next(); value = nextValue; result = nextValue; }
assert.sameValue(result, true);
assert.sameValue(value, true);
assert.compareArray(log, ["rhs"]);
console.log("assignments-or-false-boolean:ok");
