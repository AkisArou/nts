/*---
description: "AND assignment returns the unconstrained RHS before typed-array conversion. Route: Uint8Array nonzero index (control)"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// AND assignment returns the unconstrained RHS before typed-array conversion. Route: Uint8Array nonzero index. Node prints assignments-typedarray-and-expression:ok.
const view = new Uint8Array([1]);
const saved = view[0]; let result: number = saved;
if (saved) { const next = 300; view[0] = next; result = next; }
assert.sameValue(result, 300);
assert.sameValue(view[0], 44);
console.log("assignments-typedarray-and-expression:ok");
