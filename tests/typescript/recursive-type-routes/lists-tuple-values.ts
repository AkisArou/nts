/*---
description: "A recursive cons tuple retains four numeric levels. Route: generic recursive tuple alias"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A recursive cons tuple retains four numeric levels. Route: generic recursive tuple alias. Node prints lists-tuple-values:ok.
type Cons<T>=[T,Cons<T>|null];type ConsView<T>=Cons<T>;
const cons:ConsView<number>=[1,[2,[3,[-0,null]]]];
let item:ConsView<number>|null=cons;const log:number[]=[];
while(item!==null){log.push(item[0]);item=item[1];}
assert.compareArray(log,[1,2,3,-0]);
console.log("lists-tuple-values:ok");
