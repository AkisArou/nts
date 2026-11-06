/*---
description: "A single recursive list ends in null. Route: direct next field (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A single recursive list ends in null. Route: direct next field. Node prints lists-one-head:ok.
type L0 = {value:number;next:null};
type L1 = {value:number;next:L0};
type L2 = {value:number;next:L1};
type L3 = {value:number;next:L2};
type L4 = {value:number;next:L3};
type L5 = {value:number;next:L4};
type ListView = L0 | L1 | L2 | L3 | L4 | L5;
const head: ListView = {value:-0,next:null};
assert.sameValue(head.value,-0);assert.sameValue(head.next,null);
console.log("lists-one-head:ok");
