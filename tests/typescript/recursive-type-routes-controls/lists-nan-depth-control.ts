/*---
description: "A recursive link preserves NaN at depth five. Route: direct next field (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A recursive link preserves NaN at depth five. Route: direct next field. Node prints lists-nan-depth:ok.
type L0 = {value:number;next:null};
type L1 = {value:number;next:L0};
type L2 = {value:number;next:L1};
type L3 = {value:number;next:L2};
type L4 = {value:number;next:L3};
type L5 = {value:number;next:L4};
type ListView = L0 | L1 | L2 | L3 | L4 | L5;
const head: ListView = {value:1,next:{value:2,next:{value:-0,next:{value:4,next:{value:NaN,next:{value:6,next:null}}}}}};
let node:ListView|null=head;for(let i=0;i<4;i++){if(node===null)throw new Error("short");node=node.next;}
if(node===null)throw new Error("missing");assert.sameValue(node.value,NaN);
console.log("lists-nan-depth:ok");
