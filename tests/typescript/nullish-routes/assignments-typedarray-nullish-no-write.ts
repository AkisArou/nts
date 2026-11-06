/*---
description: "Nullish assignment on typed-array storage cannot select its RHS. Route: Uint8Array element always number"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// Nullish assignment on typed-array storage cannot select its RHS. Route: Uint8Array element always number. Node prints assignments-typedarray-nullish-no-write:ok.
const view = new Uint8Array([0]);
const log: string[] = [];
function rhs(): number { log.push("rhs"); return 300; }
const result = (view[0] ??= rhs());
assert.sameValue(result, 0);
assert.sameValue(view[0], 0);
assert.compareArray(log, []);
console.log("assignments-typedarray-nullish-no-write:ok");
