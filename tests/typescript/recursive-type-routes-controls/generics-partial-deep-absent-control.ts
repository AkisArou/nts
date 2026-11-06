/*---
description: "Recursive mapped DeepPartial keeps a nested absent field distinct from present. Route: partial-deep-absent (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// Recursive mapped DeepPartial keeps a nested absent field distinct from present. Route: partial-deep-absent. Node prints generics-partial-deep-absent:ok.
type View={child?:{child?:{value?:number}}};
const data:View={child:{child:{}}};

assert.sameValue(data.child?.child?.value,undefined);
console.log("generics-partial-deep-absent:ok");
