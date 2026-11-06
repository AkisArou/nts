/*---
description: "A recursive string cons tuple keeps an empty final string. Route: generic recursive tuple alias"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A recursive string cons tuple keeps an empty final string. Route: generic recursive tuple alias. Node prints lists-tuple-strings:ok.
type Cons<T>=[T,Cons<T>|null];type ConsView<T>=Cons<T>;
const cons:ConsView<string>=["a",["b",["",null]]];
let item:ConsView<string>|null=cons;let last="unset";
while(item!==null){last=item[0];item=item[1];}
assert.sameValue(last,"");
console.log("lists-tuple-strings:ok");
