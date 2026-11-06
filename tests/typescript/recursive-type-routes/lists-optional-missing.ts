/*---
description: "An optional recursive next field is absent at the tail. Route: optional direct field"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// An optional recursive next field is absent at the tail. Route: optional direct field. Node prints lists-optional-missing:ok.
interface OptionalRLink {value:number;next?:OptionalRLink}
type OptionalView = OptionalRLink;
const tail:OptionalView={value:8};assert.sameValue(tail.next,undefined);assert.sameValue("next" in tail,false);
console.log("lists-optional-missing:ok");
