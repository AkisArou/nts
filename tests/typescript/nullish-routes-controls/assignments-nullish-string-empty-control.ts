/*---
description: "Nullish assignment preserves empty text. Route: declared variable type (control)"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// Nullish assignment preserves empty text. Route: declared variable type. Node prints assignments-nullish-string-empty:ok.
let value: string | null = "";
const log: string[] = [];
function next(): string | null { log.push("rhs"); return "x"; }
const saved = value; let result: string | null = saved;
if (saved === null || saved === undefined) { const nextValue = next(); value = nextValue; result = nextValue; }
assert.sameValue(result, "");
assert.sameValue(value, "");
assert.compareArray(log, []);
console.log("assignments-nullish-string-empty:ok");
