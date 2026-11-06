/*---
description: "An optional recursive next field retains its child. Route: optional direct field (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// An optional recursive next field retains its child. Route: optional direct field. Node prints lists-optional-present:ok.
type O0={value:number;next?:undefined};type O1={value:number;next?:O0};type O2={value:number;next?:O1};type OptionalView=O0|O1|O2;
const tail={value:3};const root:OptionalView={value:1,next:{value:2,next:tail}};
assert.sameValue(root.next?.next===tail,true);assert.sameValue("next" in root,true);
console.log("lists-optional-present:ok");
