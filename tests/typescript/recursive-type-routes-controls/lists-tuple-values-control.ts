/*---
description: "A recursive cons tuple retains four numeric levels. Route: generic recursive tuple alias (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A recursive cons tuple retains four numeric levels. Route: generic recursive tuple alias. Node prints lists-tuple-values:ok.
type C0<T>=[T,null];type C1<T>=[T,C0<T>];type C2<T>=[T,C1<T>];type C3<T>=[T,C2<T>];type ConsView<T>=C0<T>|C1<T>|C2<T>|C3<T>;
const cons:ConsView<number>=[1,[2,[3,[-0,null]]]];
let item:ConsView<number>|null=cons;const log:number[]=[];
while(item!==null){log.push(item[0]);item=item[1];}
assert.compareArray(log,[1,2,3,-0]);
console.log("lists-tuple-values:ok");
