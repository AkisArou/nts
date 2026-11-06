/*---
description: "Two Set levels share the same nested Set object. Route: bag-shared (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Two Set levels share the same nested Set object. Route: bag-shared. Node prints collections-bag-shared:ok.
type S0=Set<number>;type S1=Set<number|S0>;type S2=Set<number|S1>;type View=S0|S1|S2;
const leaf:S0=new Set<number>([-0,NaN,3]);const middle:S1=new Set<number|S0>([leaf,5]);const root:View=new Set<number|S1>([middle]);
const other:View=new Set<number|S0>([leaf]);
assert.sameValue(other.has(leaf),true);assert.sameValue(middle.has(leaf),true);
console.log("collections-bag-shared:ok");
