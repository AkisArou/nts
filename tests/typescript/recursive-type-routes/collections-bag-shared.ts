/*---
description: "Two Set levels share the same nested Set object. Route: bag-shared"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Two Set levels share the same nested Set object. Route: bag-shared. Node prints collections-bag-shared:ok.
type Bag=Set<number|Bag>;type View=Bag;
const leaf:Bag=new Set<number|Bag>([-0,NaN,3]);const middle:Bag=new Set<number|Bag>([leaf,5]);const root:View=new Set<number|Bag>([middle]);
const other:View=new Set<number|Bag>([leaf]);
assert.sameValue(other.has(leaf),true);assert.sameValue(middle.has(leaf),true);
console.log("collections-bag-shared:ok");
