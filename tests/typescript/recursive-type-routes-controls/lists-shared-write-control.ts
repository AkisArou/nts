/*---
description: "A write to a shared recursive tail is visible from both heads. Route: shared recursive link (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A write to a shared recursive tail is visible from both heads. Route: shared recursive link. Node prints lists-shared-write:ok.
type S0={value:number;next:null};type S1={value:number;next:S0};type S2={value:number;next:S1};type SharedView=S0|S1|S2;
const tail={value:4,next:null};const left:SharedView={value:1,next:tail};const right:SharedView={value:2,next:tail};
if(left.next===null)throw new Error("missing");left.next.value=9;
assert.sameValue(right.next?.value,9);assert.sameValue(left.next===right.next,true);
console.log("lists-shared-write:ok");
