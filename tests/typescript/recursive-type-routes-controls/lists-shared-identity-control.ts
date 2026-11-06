/*---
description: "Two recursive lists share the same tail object. Route: shared recursive link (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// Two recursive lists share the same tail object. Route: shared recursive link. Node prints lists-shared-identity:ok.
type S0={value:number;next:null};type S1={value:number;next:S0};type S2={value:number;next:S1};type SharedView=S0|S1|S2;
const tail={value:-0,next:null};const left:SharedView={value:1,next:tail};const right:SharedView={value:2,next:tail};
assert.sameValue(left.next===right.next,true);assert.sameValue(tail.value,-0);
console.log("lists-shared-identity:ok");
