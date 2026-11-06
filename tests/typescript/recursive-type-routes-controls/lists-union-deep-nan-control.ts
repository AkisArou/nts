/*---
description: "A deeply nested recursive union retains NaN. Route: recursive union payload (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A deeply nested recursive union retains NaN. Route: recursive union payload. Node prints lists-union-deep-nan:ok.
type Payload=number|string|boolean|bigint|null;type U0={value:Payload;next:null};type U1={value:Payload;next:U0};type U2={value:Payload;next:U1};type U3={value:Payload;next:U2};type U4={value:Payload;next:U3};type U5={value:Payload;next:U4};type UnionView=U0|U1|U2|U3|U4|U5;
const head:UnionView={value:0,next:{value:false,next:{value:null,next:{value:"",next:{value:-0,next:{value:NaN,next:null}}}}}};
let node:UnionView|null=head;for(let i=0;i<5;i++){if(node===null)throw new Error("short");node=node.next;}
if(node===null)throw new Error("missing");assert.sameValue(node.value,NaN);
console.log("lists-union-deep-nan:ok");
