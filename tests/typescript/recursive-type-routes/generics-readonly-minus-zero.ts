/*---
description: "A recursive mapped DeepReadonly type preserves a deep numeric value. Route: readonly-minus-zero"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A recursive mapped DeepReadonly type preserves a deep numeric value. Route: readonly-minus-zero. Node prints generics-readonly-minus-zero:ok.
type DeepReadonly<T>=T extends object?{readonly [K in keyof T]:DeepReadonly<T[K]>}:T;interface Data{child:{child:{value:number}}};type View=DeepReadonly<Data>;
const data:View={child:{child:{value:-0}}};

assert.sameValue(data.child.child.value,-0);
console.log("generics-readonly-minus-zero:ok");
