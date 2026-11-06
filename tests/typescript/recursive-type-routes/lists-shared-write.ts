/*---
description: "A write to a shared recursive tail is visible from both heads. Route: shared recursive link"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A write to a shared recursive tail is visible from both heads. Route: shared recursive link. Node prints lists-shared-write:ok.
interface SharedRNode {value:number;next:SharedRNode|null}
type SharedView=SharedRNode;
const tail={value:4,next:null};const left:SharedView={value:1,next:tail};const right:SharedView={value:2,next:tail};
if(left.next===null)throw new Error("missing");left.next.value=9;
assert.sameValue(right.next?.value,9);assert.sameValue(left.next===right.next,true);
console.log("lists-shared-write:ok");
