/*---
description: "Two recursive parents share one child reference. Route: shared-child-identity (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Two recursive parents share one child reference. Route: shared-child-identity; node prints trees-shared-child-identity:ok.
type S0={value:number;children:[]};type S1={value:number;children:S0[]};type View=S0|S1;
const leaf:S0={value:7,children:[]};const left:View={value:1,children:[leaf]};const right:View={value:2,children:[leaf]};
const a=left.children[0];const z=right.children[0];
assert.sameValue(a===z,true);
console.log("trees-shared-child-identity:ok");
