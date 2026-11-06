/*---
description: "A single recursive list ends in null. Route: direct next field"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A single recursive list ends in null. Route: direct next field. Node prints lists-one-head:ok.
interface RList { value: number; next: RList | null }
type ListView = RList;
const head: ListView = {value:-0,next:null};
assert.sameValue(head.value,-0);assert.sameValue(head.next,null);
console.log("lists-one-head:ok");
