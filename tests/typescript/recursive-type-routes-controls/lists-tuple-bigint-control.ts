/*---
description: "A recursive cons tuple retains zero bigint at depth three. Route: generic tuple bigint (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A recursive cons tuple retains zero bigint at depth three. Route: generic tuple bigint. Node prints lists-tuple-bigint:ok.
type C0<T>=[T,null];type C1<T>=[T,C0<T>];type C2<T>=[T,C1<T>];type C3<T>=[T,C2<T>];type ConsView<T>=C0<T>|C1<T>|C2<T>|C3<T>;
const head:ConsView<bigint>=[4n,[3n,[0n,null]]];
let node:ConsView<bigint>|null=head;for(let i=0;i<2;i++){if(node===null)throw new Error("short");node=node[1];}
if(node===null)throw new Error("missing");assert.sameValue(node[0],0n);
console.log("lists-tuple-bigint:ok");
