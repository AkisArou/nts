/*---
description: "A depth-four write stays visible through an aliased list. Route: shared recursive link"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A depth-four write stays visible through an aliased list. Route: shared recursive link. Node prints lists-shared-deep-write:ok.
interface SharedRNode {value:number;next:SharedRNode|null}
type SharedView=SharedRNode;
const tail={value:6,next:null};const left:SharedView={value:1,next:{value:2,next:{value:3,next:{value:4,next:tail}}}};const right:SharedView={value:5,next:tail};
if(left.next===null||left.next.next===null||left.next.next.next===null||left.next.next.next.next===null)throw new Error("short");left.next.next.next.next.value=17;
assert.sameValue(right.next?.value,17);assert.sameValue(left.next.next.next.next===right.next,true);
console.log("lists-shared-deep-write:ok");
