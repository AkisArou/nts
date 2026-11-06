/*---
description: "Deleting a nested Set leaf retains the other entries. Route: bag-delete (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Deleting a nested Set leaf retains the other entries. Route: bag-delete. Node prints collections-bag-delete:ok.
type S0=Set<number>;type S1=Set<number|S0>;type S2=Set<number|S1>;type View=S0|S1|S2;
const leaf:S0=new Set<number>([-0,NaN,3]);const middle:S1=new Set<number|S0>([leaf,5]);const root:View=new Set<number|S1>([middle]);
leaf.delete(3);function collect(bag:View):number[]{const out:number[]=[];for(const item of bag){if(typeof item==='number')out.push(item);else out.push(...collect(item));}return out;}
assert.compareArray(collect(root),[0,NaN,5]);
console.log("collections-bag-delete:ok");
