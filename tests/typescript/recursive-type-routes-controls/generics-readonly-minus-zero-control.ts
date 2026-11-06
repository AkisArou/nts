/*---
description: "A recursive mapped DeepReadonly type preserves a deep numeric value. Route: readonly-minus-zero (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A recursive mapped DeepReadonly type preserves a deep numeric value. Route: readonly-minus-zero. Node prints generics-readonly-minus-zero:ok.
type View={readonly child:{readonly child:{readonly value:number}}};
const data:View={child:{child:{value:-0}}};

assert.sameValue(data.child.child.value,-0);
console.log("generics-readonly-minus-zero:ok");
