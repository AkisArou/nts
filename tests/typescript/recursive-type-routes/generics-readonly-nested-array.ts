/*---
description: "DeepReadonly recursively preserves signed zero inside nested array fields. Route: readonly-nested-array"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// DeepReadonly recursively preserves signed zero inside nested array fields. Route: readonly-nested-array. Node prints generics-readonly-nested-array:ok.
type DeepReadonly<T>=T extends object?{readonly [K in keyof T]:DeepReadonly<T[K]>}:T;interface Payload{items:{child:{value:number}}[]};type View=DeepReadonly<Payload>;
const data:View={items:[{child:{value:-0}}]};assert.sameValue(data.items[0].child.value,-0);
console.log("generics-readonly-nested-array:ok");
