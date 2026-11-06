/*---
description: "Nested Set depth is retained through recursive aliases. Route: bag-depth"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Nested Set depth is retained through recursive aliases. Route: bag-depth. Node prints collections-bag-depth:ok.
type Bag=Set<number|Bag>;type View=Bag;
const leaf:Bag=new Set<number|Bag>([-0,NaN,3]);const middle:Bag=new Set<number|Bag>([leaf,5]);const root:View=new Set<number|Bag>([middle]);
function depth(b:View):number{let d=1;for(const item of b)if(typeof item!=='number')d=Math.max(d,1+depth(item));return d;}
assert.sameValue(depth(root),3);
console.log("collections-bag-depth:ok");
