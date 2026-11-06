/*---
description: "A recursive JSON-like structure serializes nested values in order. Route: json-json-print (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// A recursive JSON-like structure serializes nested values in order. Route: json-json-print. Node prints unions-json-json-print:ok.
type J0=null|boolean|number|string|[]|{[key:string]:never};type J1=J0|J0[]|{[k:string]:J0};type J2=J0|J1[]|{[k:string]:J1};type J3=J0|J2[]|{[k:string]:J2};type View=J0|J1|J2|J3;
const value:View={a:[{b:0},{b:false}]};
assert.sameValue(JSON.stringify(value),"{\"a\":[{\"b\":0},{\"b\":false}]}");
console.log("unions-json-json-print:ok");
