/*---
description: "A recursive mapped DeepReadonly type preserves a deep numeric value. Route: readonly-nan"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A recursive mapped DeepReadonly type preserves a deep numeric value. Route: readonly-nan. Node prints generics-readonly-nan:ok.
type DeepReadonly<T>=T extends object?{readonly [K in keyof T]:DeepReadonly<T[K]>}:T;interface Data{child:{child:{value:number}}};type View=DeepReadonly<Data>;
const data:View={child:{child:{value:NaN}}};

assert.sameValue(data.child.child.value,NaN);
console.log("generics-readonly-nan:ok");
