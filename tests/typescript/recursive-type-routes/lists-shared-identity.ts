/*---
description: "Two recursive lists share the same tail object. Route: shared recursive link"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// Two recursive lists share the same tail object. Route: shared recursive link. Node prints lists-shared-identity:ok.
interface SharedRNode {value:number;next:SharedRNode|null}
type SharedView=SharedRNode;
const tail={value:-0,next:null};const left:SharedView={value:1,next:tail};const right:SharedView={value:2,next:tail};
assert.sameValue(left.next===right.next,true);assert.sameValue(tail.value,-0);
console.log("lists-shared-identity:ok");
