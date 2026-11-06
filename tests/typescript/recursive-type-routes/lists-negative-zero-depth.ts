/*---
description: "A recursive link preserves negative zero at depth three. Route: direct next field"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A recursive link preserves negative zero at depth three. Route: direct next field. Node prints lists-negative-zero-depth:ok.
interface RList { value: number; next: RList | null }
type ListView = RList;
const head: ListView = {value:1,next:{value:2,next:{value:-0,next:{value:4,next:{value:NaN,next:{value:6,next:null}}}}}};
let node:ListView|null=head;for(let i=0;i<2;i++){if(node===null)throw new Error("short");node=node.next;}
if(node===null)throw new Error("missing");assert.sameValue(node.value,-0);
console.log("lists-negative-zero-depth:ok");
