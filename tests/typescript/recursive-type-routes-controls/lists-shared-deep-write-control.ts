/*---
description: "A depth-four write stays visible through an aliased list. Route: shared recursive link (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A depth-four write stays visible through an aliased list. Route: shared recursive link. Node prints lists-shared-deep-write:ok.
type S0={value:number;next:null};type S1={value:number;next:S0};type S2={value:number;next:S1};type S3={value:number;next:S2};type S4={value:number;next:S3};type SharedView=S0|S1|S2|S3|S4;
const tail={value:6,next:null};const left:SharedView={value:1,next:{value:2,next:{value:3,next:{value:4,next:tail}}}};const right:SharedView={value:5,next:tail};
if(left.next===null||left.next.next===null||left.next.next.next===null||left.next.next.next.next===null)throw new Error("short");left.next.next.next.next.value=17;
assert.sameValue(right.next?.value,17);assert.sameValue(left.next.next.next.next===right.next,true);
console.log("lists-shared-deep-write:ok");
