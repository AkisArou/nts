/*---
description: "An optional recursive next field retains its child. Route: optional direct field"
features: [ts-recursive-type-routes, ts-recursive-type-route-lists]
---*/

// An optional recursive next field retains its child. Route: optional direct field. Node prints lists-optional-present:ok.
interface OptionalRLink {value:number;next?:OptionalRLink}
type OptionalView = OptionalRLink;
const tail={value:3};const root:OptionalView={value:1,next:{value:2,next:tail}};
assert.sameValue(root.next?.next===tail,true);assert.sameValue("next" in root,true);
console.log("lists-optional-present:ok");
