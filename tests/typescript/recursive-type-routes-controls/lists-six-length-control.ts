/*---
description: "A six-node recursive list retains its depth. Route: direct next field (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A six-node recursive list retains its depth. Route: direct next field. Node prints lists-six-length:ok.
type L0 = {value:number;next:null};
type L1 = {value:number;next:L0};
type L2 = {value:number;next:L1};
type L3 = {value:number;next:L2};
type L4 = {value:number;next:L3};
type L5 = {value:number;next:L4};
type ListView = L0 | L1 | L2 | L3 | L4 | L5;
const head: ListView = {value:1,next:{value:2,next:{value:-0,next:{value:4,next:{value:NaN,next:{value:6,next:null}}}}}};
let count=0;let node:ListView|null=head;
while(node!==null){count++;node=node.next;}
assert.sameValue(count,6);
console.log("lists-six-length:ok");
