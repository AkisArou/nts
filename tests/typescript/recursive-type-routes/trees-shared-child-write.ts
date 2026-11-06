/*---
description: "A write through one parent stays visible through the other. Route: shared-child-write"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// A write through one parent stays visible through the other. Route: shared-child-write; node prints trees-shared-child-write:ok.
interface RouteSharedNode{value:number;children:RouteSharedNode[]};type View=RouteSharedNode;
const leaf:RouteSharedNode={value:7,children:[]};const left:View={value:1,children:[leaf]};const right:View={value:2,children:[leaf]};
left.children[0].value=42;
assert.sameValue(right.children[0].value,42);
console.log("trees-shared-child-write:ok");
