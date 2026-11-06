/*---
description: "A six-node recursive list retains its depth. Route: direct next field"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A six-node recursive list retains its depth. Route: direct next field. Node prints lists-six-length:ok.
interface RList { value: number; next: RList | null }
type ListView = RList;
const head: ListView = {value:1,next:{value:2,next:{value:-0,next:{value:4,next:{value:NaN,next:{value:6,next:null}}}}}};
let count=0;let node:ListView|null=head;
while(node!==null){count++;node=node.next;}
assert.sameValue(count,6);
console.log("lists-six-length:ok");
