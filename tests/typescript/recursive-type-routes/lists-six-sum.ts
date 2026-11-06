/*---
description: "A typed recursive list sums the numeric leaves while skipping NaN. Route: direct next field"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A typed recursive list sums the numeric leaves while skipping NaN. Route: direct next field. Node prints lists-six-sum:ok.
interface RList { value: number; next: RList | null }
type ListView = RList;
const head: ListView = {value:1,next:{value:2,next:{value:-0,next:{value:4,next:{value:NaN,next:{value:6,next:null}}}}}};
let sum=0;let node:ListView|null=head;
while(node!==null){if(!Number.isNaN(node.value))sum+=node.value;node=node.next;}
assert.sameValue(sum,13);
console.log("lists-six-sum:ok");
