/*---
description: "OR assignment replaces empty text. Route: declared variable type (control)"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// OR assignment replaces empty text. Route: declared variable type. Node prints assignments-or-string-empty:ok.
let value: string | undefined = "";
const log: string[] = [];
function next(): string | undefined { log.push("rhs"); return "x"; }
const saved = value; let result: string | undefined = saved;
if (!saved) { const nextValue = next(); value = nextValue; result = nextValue; }
assert.sameValue(result, "x");
assert.sameValue(value, "x");
assert.compareArray(log, ["rhs"]);
console.log("assignments-or-string-empty:ok");
