/*---
description: "OR assignment returns the unconstrained RHS before typed-array conversion. Route: Uint8Array index zero (control)"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// OR assignment returns the unconstrained RHS before typed-array conversion. Route: Uint8Array index zero. Node prints assignments-typedarray-or-expression:ok.
const view = new Uint8Array([0]);
const saved = view[0]; let result: number = saved;
if (!saved) { const next = 300; view[0] = next; result = next; }
assert.sameValue(result, 300);
assert.sameValue(view[0], 44);
console.log("assignments-typedarray-or-expression:ok");
