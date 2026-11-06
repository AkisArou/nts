/*---
description: "A null recursive list is empty. Route: nullable direct next field"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A null recursive list is empty. Route: nullable direct next field. Node prints lists-null-head:ok.
interface RList { value: number; next: RList | null }
type ListView = RList;
function emptyHead(): ListView | null { return null; }
const head: ListView | null = emptyHead();
let count = 0; let cur: ListView | null = head;
while(cur !== null){count++;cur=cur.next;}
assert.sameValue(count,0);assert.sameValue(cur,null);
console.log("lists-null-head:ok");
