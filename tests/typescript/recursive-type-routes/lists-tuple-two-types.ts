/*---
description: "One generic cons traversal preserves both number and string instantiations. Route: generic tuple parameter"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// One generic cons traversal preserves both number and string instantiations. Route: generic tuple parameter. Node prints lists-tuple-two-types:ok.
type Cons<T>=[T,Cons<T>|null];type ConsView<T>=Cons<T>;
function values<T>(list:ConsView<T>):T[]{const out:T[]=[];let p:ConsView<T>|null=list;while(p!==null){out.push(p[0]);p=p[1];}return out;}
assert.compareArray(values<number>([0,[-0,null]]),[0,-0]);
assert.compareArray(values<string>(["",["end",null]]),["","end"]);
console.log("lists-tuple-two-types:ok");
