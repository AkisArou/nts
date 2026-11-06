/*---
description: "Recursive mapped DeepPartial values retain deep optional fields. Route: partial-deep-present"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// Recursive mapped DeepPartial values retain deep optional fields. Route: partial-deep-present. Node prints generics-partial-deep-present:ok.
type DeepPartial<T>={[K in keyof T]?:DeepPartial<T[K]>};interface Data{child:{child:{value:number}}};type View=DeepPartial<Data>;
const data:View={child:{child:{value:-0}}};

assert.sameValue(data.child?.child?.value,-0);
console.log("generics-partial-deep-present:ok");
