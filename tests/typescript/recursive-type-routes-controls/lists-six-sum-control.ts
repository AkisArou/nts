/*---
description: "A typed recursive list sums the numeric leaves while skipping NaN. Route: direct next field (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A typed recursive list sums the numeric leaves while skipping NaN. Route: direct next field. Node prints lists-six-sum:ok.
type L0 = {value:number;next:null};
type L1 = {value:number;next:L0};
type L2 = {value:number;next:L1};
type L3 = {value:number;next:L2};
type L4 = {value:number;next:L3};
type L5 = {value:number;next:L4};
type ListView = L0 | L1 | L2 | L3 | L4 | L5;
const head: ListView = {value:1,next:{value:2,next:{value:-0,next:{value:4,next:{value:NaN,next:{value:6,next:null}}}}}};
let sum=0;let node:ListView|null=head;
while(node!==null){if(!Number.isNaN(node.value))sum+=node.value;node=node.next;}
assert.sameValue(sum,13);
console.log("lists-six-sum:ok");
