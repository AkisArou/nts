/*---
description: "A recursive mapped DeepReadonly type preserves a deep numeric value. Route: readonly-nan (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A recursive mapped DeepReadonly type preserves a deep numeric value. Route: readonly-nan. Node prints generics-readonly-nan:ok.
type View={readonly child:{readonly child:{readonly value:number}}};
const data:View={child:{child:{value:NaN}}};

assert.sameValue(data.child.child.value,NaN);
console.log("generics-readonly-nan:ok");
