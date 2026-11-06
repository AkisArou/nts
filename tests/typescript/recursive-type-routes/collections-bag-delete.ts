/*---
description: "Deleting a nested Set leaf retains the other entries. Route: bag-delete"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Deleting a nested Set leaf retains the other entries. Route: bag-delete. Node prints collections-bag-delete:ok.
type Bag=Set<number|Bag>;type View=Bag;
const leaf:Bag=new Set<number|Bag>([-0,NaN,3]);const middle:Bag=new Set<number|Bag>([leaf,5]);const root:View=new Set<number|Bag>([middle]);
leaf.delete(3);function collect(bag:View):number[]{const out:number[]=[];for(const item of bag){if(typeof item==='number')out.push(item);else out.push(...collect(item));}return out;}
assert.compareArray(collect(root),[0,NaN,5]);
console.log("collections-bag-delete:ok");
