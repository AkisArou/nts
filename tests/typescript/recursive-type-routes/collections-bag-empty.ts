/*---
description: "An empty nested Set is still a present object. Route: bag-empty"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// An empty nested Set is still a present object. Route: bag-empty. Node prints collections-bag-empty:ok.
type Bag=Set<number|Bag>;type View=Bag;
const leaf:Bag=new Set<number|Bag>([-0,NaN,3]);const middle:Bag=new Set<number|Bag>([leaf,5]);const root:View=new Set<number|Bag>([middle]);
const empty:View=new Set();
assert.sameValue(empty.size,0);assert.sameValue(root.size,1);
console.log("collections-bag-empty:ok");
