/*---
description: "A null recursive list is empty. Route: nullable direct next field (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A null recursive list is empty. Route: nullable direct next field. Node prints lists-null-head:ok.
type L0 = {value:number;next:null};
type L1 = {value:number;next:L0};
type L2 = {value:number;next:L1};
type L3 = {value:number;next:L2};
type L4 = {value:number;next:L3};
type L5 = {value:number;next:L4};
type ListView = L0 | L1 | L2 | L3 | L4 | L5;
function emptyHead(): ListView | null { return null; }
const head: ListView | null = emptyHead();
let count = 0; let cur: ListView | null = head;
while(cur !== null){count++;cur=cur.next;}
assert.sameValue(count,0);assert.sameValue(cur,null);
console.log("lists-null-head:ok");
