/*---
description: "A recursive JSON-like structure serializes nested values in order. Route: json-json-print"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// A recursive JSON-like structure serializes nested values in order. Route: json-json-print. Node prints unions-json-json-print:ok.
type Json=null|boolean|number|string|Json[]|{[key:string]:Json};type View=Json;
const value:View={a:[{b:0},{b:false}]};
assert.sameValue(JSON.stringify(value),"{\"a\":[{\"b\":0},{\"b\":false}]}");
console.log("unions-json-json-print:ok");
