/*---
description: "A nested recursive Record visits numeric keys before string keys. Route: record-numeric-keys (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A nested recursive Record visits numeric keys before string keys. Route: record-numeric-keys. Node prints collections-record-numeric-keys:ok.
type D0={files:Record<string,number>;dirs:Record<string,never>};type D1={files:Record<string,number>;dirs:Record<string,D0>};
const leaf:D0={files:{b:1,2:2,a:3,1:4},dirs:{}};const root:D1={files:{},dirs:{child:leaf}};const log:string[]=[];for(const k in root.dirs.child.files)log.push(k);assert.compareArray(log,['1','2','b','a']);
console.log("collections-record-numeric-keys:ok");
