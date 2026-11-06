/*---
description: "An optional recursive next field is absent at the tail. Route: optional direct field (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// An optional recursive next field is absent at the tail. Route: optional direct field. Node prints lists-optional-missing:ok.
type O0={value:number;next?:undefined};type O1={value:number;next?:O0};type O2={value:number;next?:O1};type OptionalView=O0|O1|O2;
const tail:OptionalView={value:8};assert.sameValue(tail.next,undefined);assert.sameValue("next" in tail,false);
console.log("lists-optional-missing:ok");
