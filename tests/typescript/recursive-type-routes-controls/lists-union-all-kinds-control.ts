/*---
description: "Nested recursive links retain null false signed zero empty text and zero bigint. Route: recursive union payload (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// Nested recursive links retain null false signed zero empty text and zero bigint. Route: recursive union payload. Node prints lists-union-all-kinds:ok.
type Payload=number|string|boolean|bigint|null;type U0={value:Payload;next:null};type U1={value:Payload;next:U0};type U2={value:Payload;next:U1};type U3={value:Payload;next:U2};type U4={value:Payload;next:U3};type U5={value:Payload;next:U4};type UnionView=U0|U1|U2|U3|U4|U5;
const head:UnionView={value:null,next:{value:false,next:{value:0,next:{value:-0,next:{value:"",next:{value:0n,next:null}}}}}};
const expected:Payload[]=[null,false,0,-0,"",0n];let node:UnionView|null=head;let i=0;
while(node!==null){assert.sameValue(node.value,expected[i++]);node=node.next;}assert.sameValue(i,6);
console.log("lists-union-all-kinds:ok");
