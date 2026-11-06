/*---
description: "AND assignment returns the unconstrained RHS before typed-array conversion. Route: Uint8Array nonzero index"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// AND assignment returns the unconstrained RHS before typed-array conversion. Route: Uint8Array nonzero index. Node prints assignments-typedarray-and-expression:ok.
const view = new Uint8Array([1]);
const result = (view[0] &&= 300);
assert.sameValue(result, 300);
assert.sameValue(view[0], 44);
console.log("assignments-typedarray-and-expression:ok");
