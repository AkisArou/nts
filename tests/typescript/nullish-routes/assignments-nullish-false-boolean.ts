/*---
description: "Nullish assignment keeps a typed false boolean and skips the RHS. Route: boolean-or-undefined declared variable"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// Nullish assignment keeps a typed false boolean and skips the RHS. Route: boolean-or-undefined declared variable. Node prints assignments-nullish-false-boolean:ok.
let value: boolean | undefined = false;
const log: string[] = [];
function rhs(): boolean { log.push("rhs"); return true; }
const result = (value ??= rhs());
assert.sameValue(result, false);
assert.sameValue(value, false);
assert.compareArray(log, []);
console.log("assignments-nullish-false-boolean:ok");
