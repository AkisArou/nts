/*---
description: "Walking optional recursive links stops after three nodes. Route: optional direct field (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// Walking optional recursive links stops after three nodes. Route: optional direct field. Node prints lists-optional-walk:ok.
type O0={value:number;next?:undefined};type O1={value:number;next?:O0};type O2={value:number;next?:O1};type OptionalView=O0|O1|O2;
const root:OptionalView={value:1,next:{value:2,next:{value:3}}};
let cur:OptionalView|undefined=root;let total=0;let count=0;
while(cur!==undefined){total+=cur.value;count++;cur=cur.next;}
assert.sameValue(total,6);assert.sameValue(count,3);
console.log("lists-optional-walk:ok");
