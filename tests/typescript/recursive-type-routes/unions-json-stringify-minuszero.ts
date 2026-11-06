/*---
description: "Nested recursive JSON serialization converts signed zero to numeric zero. Route: json-stringify-minuszero"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// Nested recursive JSON serialization converts signed zero to numeric zero. Route: json-stringify-minuszero. Node prints unions-json-stringify-minuszero:ok.
type Json=null|boolean|number|string|Json[]|{[key:string]:Json};type View=Json;
const value:View={a:[{b:-0}]};assert.sameValue(JSON.stringify(value),'{"a":[{"b":0}]}');
console.log("unions-json-stringify-minuszero:ok");
