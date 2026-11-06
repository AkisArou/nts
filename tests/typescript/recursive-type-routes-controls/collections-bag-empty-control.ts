/*---
description: "An empty nested Set is still a present object. Route: bag-empty (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// An empty nested Set is still a present object. Route: bag-empty. Node prints collections-bag-empty:ok.
type S0=Set<number>;type S1=Set<number|S0>;type S2=Set<number|S1>;type View=S0|S1|S2;
const leaf:S0=new Set<number>([-0,NaN,3]);const middle:S1=new Set<number|S0>([leaf,5]);const root:View=new Set<number|S1>([middle]);
const empty:View=new Set();
assert.sameValue(empty.size,0);assert.sameValue(root.size,1);
console.log("collections-bag-empty:ok");
