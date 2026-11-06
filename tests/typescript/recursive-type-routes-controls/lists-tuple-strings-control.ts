/*---
description: "A recursive string cons tuple keeps an empty final string. Route: generic recursive tuple alias (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A recursive string cons tuple keeps an empty final string. Route: generic recursive tuple alias. Node prints lists-tuple-strings:ok.
type C0<T>=[T,null];type C1<T>=[T,C0<T>];type C2<T>=[T,C1<T>];type C3<T>=[T,C2<T>];type ConsView<T>=C0<T>|C1<T>|C2<T>|C3<T>;
const cons:ConsView<string>=["a",["b",["",null]]];
let item:ConsView<string>|null=cons;let last="unset";
while(item!==null){last=item[0];item=item[1];}
assert.sameValue(last,"");
console.log("lists-tuple-strings:ok");
