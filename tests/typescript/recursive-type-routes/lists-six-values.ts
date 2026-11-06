/*---
description: "A six-node recursive list retains traversal values and order. Route: direct next field"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A six-node recursive list retains traversal values and order. Route: direct next field. Node prints lists-six-values:ok.
interface RList { value: number; next: RList | null }
type ListView = RList;
const head: ListView = {value:1,next:{value:2,next:{value:-0,next:{value:4,next:{value:NaN,next:{value:6,next:null}}}}}};
const log:string[]=[];let node:ListView|null=head;
while(node!==null){log.push(Object.is(node.value,-0)?"-0":String(node.value));node=node.next;}
assert.compareArray(log,["1","2","-0","4","NaN","6"]);
console.log("lists-six-values:ok");
