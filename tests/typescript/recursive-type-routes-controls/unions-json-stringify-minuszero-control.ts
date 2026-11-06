/*---
description: "Nested recursive JSON serialization converts signed zero to numeric zero. Route: json-stringify-minuszero (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// Nested recursive JSON serialization converts signed zero to numeric zero. Route: json-stringify-minuszero. Node prints unions-json-stringify-minuszero:ok.
type J0=null|boolean|number|string|[]|{[k:string]:never};type J1=J0|J0[]|{[k:string]:J0};type J2=J0|J1[]|{[k:string]:J1};type J3=J0|J2[]|{[k:string]:J2};type View=J0|J1|J2|J3;
const value:View={a:[{b:-0}]};assert.sameValue(JSON.stringify(value),'{"a":[{"b":0}]}');
console.log("unions-json-stringify-minuszero:ok");
