/*---
description: "OR assignment returns the unconstrained RHS before typed-array conversion. Route: Uint8Array index zero"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// OR assignment returns the unconstrained RHS before typed-array conversion. Route: Uint8Array index zero. Node prints assignments-typedarray-or-expression:ok.
const view = new Uint8Array([0]);
const result = (view[0] ||= 300);
assert.sameValue(result, 300);
assert.sameValue(view[0], 44);
console.log("assignments-typedarray-or-expression:ok");
