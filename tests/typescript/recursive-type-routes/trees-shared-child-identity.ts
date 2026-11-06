/*---
description: "Two recursive parents share one child reference. Route: shared-child-identity"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Two recursive parents share one child reference. Route: shared-child-identity; node prints trees-shared-child-identity:ok.
interface RouteSharedNode{value:number;children:RouteSharedNode[]};type View=RouteSharedNode;
const leaf:RouteSharedNode={value:7,children:[]};const left:View={value:1,children:[leaf]};const right:View={value:2,children:[leaf]};
const a=left.children[0];const z=right.children[0];
assert.sameValue(a===z,true);
console.log("trees-shared-child-identity:ok");
