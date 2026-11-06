/*---
description: "A deeply nested recursive union retains NaN. Route: recursive union payload"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// A deeply nested recursive union retains NaN. Route: recursive union payload. Node prints lists-union-deep-nan:ok.
type Payload=number|string|boolean|bigint|null;interface UnionRNode{value:Payload;next:UnionRNode|null}type UnionView=UnionRNode;
const head:UnionView={value:0,next:{value:false,next:{value:null,next:{value:"",next:{value:-0,next:{value:NaN,next:null}}}}}};
let node:UnionView|null=head;for(let i=0;i<5;i++){if(node===null)throw new Error("short");node=node.next;}
if(node===null)throw new Error("missing");assert.sameValue(node.value,NaN);
console.log("lists-union-deep-nan:ok");
