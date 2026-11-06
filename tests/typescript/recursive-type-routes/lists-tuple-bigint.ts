/*---
description: "A recursive cons tuple retains zero bigint at depth three. Route: generic tuple bigint"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A recursive cons tuple retains zero bigint at depth three. Route: generic tuple bigint. Node prints lists-tuple-bigint:ok.
type Cons<T>=[T,Cons<T>|null];type ConsView<T>=Cons<T>;
const head:ConsView<bigint>=[4n,[3n,[0n,null]]];
let node:ConsView<bigint>|null=head;for(let i=0;i<2;i++){if(node===null)throw new Error("short");node=node[1];}
if(node===null)throw new Error("missing");assert.sameValue(node[0],0n);
console.log("lists-tuple-bigint:ok");
