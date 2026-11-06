/*---
description: "A write through one parent stays visible through the other. Route: shared-child-write (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// A write through one parent stays visible through the other. Route: shared-child-write; node prints trees-shared-child-write:ok.
type S0={value:number;children:[]};type S1={value:number;children:S0[]};type View=S0|S1;
const leaf:S0={value:7,children:[]};const left:View={value:1,children:[leaf]};const right:View={value:2,children:[leaf]};
left.children[0].value=42;
assert.sameValue(right.children[0].value,42);
console.log("trees-shared-child-write:ok");
