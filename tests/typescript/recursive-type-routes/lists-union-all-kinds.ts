/*---
description: "Nested recursive links retain null false signed zero empty text and zero bigint. Route: recursive union payload"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// Nested recursive links retain null false signed zero empty text and zero bigint. Route: recursive union payload. Node prints lists-union-all-kinds:ok.
type Payload=number|string|boolean|bigint|null;interface UnionRNode{value:Payload;next:UnionRNode|null}type UnionView=UnionRNode;
const head:UnionView={value:null,next:{value:false,next:{value:0,next:{value:-0,next:{value:"",next:{value:0n,next:null}}}}}};
const expected:Payload[]=[null,false,0,-0,"",0n];let node:UnionView|null=head;let i=0;
while(node!==null){assert.sameValue(node.value,expected[i++]);node=node.next;}assert.sameValue(i,6);
console.log("lists-union-all-kinds:ok");
