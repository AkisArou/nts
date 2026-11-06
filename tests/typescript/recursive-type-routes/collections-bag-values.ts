/*---
description: "Recursive nested Sets retain numeric and NaN leaves. Route: bag-values"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Recursive nested Sets retain numeric and NaN leaves. Route: bag-values. Node prints collections-bag-values:ok.
type Bag=Set<number|Bag>;type View=Bag;
const leaf:Bag=new Set<number|Bag>([-0,NaN,3]);const middle:Bag=new Set<number|Bag>([leaf,5]);const root:View=new Set<number|Bag>([middle]);
function collect(bag:View):number[]{const out:number[]=[];for(const item of bag){if(typeof item==='number')out.push(item);else out.push(...collect(item));}return out;}
assert.compareArray(collect(root),[0,NaN,3,5]);
console.log("collections-bag-values:ok");
