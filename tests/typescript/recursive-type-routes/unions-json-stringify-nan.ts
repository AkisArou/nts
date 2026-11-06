/*---
description: "Nested recursive JSON serialization converts NaN to null. Route: json-stringify-nan"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// Nested recursive JSON serialization converts NaN to null. Route: json-stringify-nan. Node prints unions-json-stringify-nan:ok.
type Json=null|boolean|number|string|Json[]|{[key:string]:Json};type View=Json;
const value:View={a:[{b:NaN}]};assert.sameValue(JSON.stringify(value),'{"a":[{"b":null}]}');
console.log("unions-json-stringify-nan:ok");
