/*---
description: "A nested recursive Record visits numeric keys before string keys. Route: record-numeric-keys"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A nested recursive Record visits numeric keys before string keys. Route: record-numeric-keys. Node prints collections-record-numeric-keys:ok.
interface Dir{files:Record<string,number>;dirs:Record<string,Dir>};
const leaf:Dir={files:{b:1,2:2,a:3,1:4},dirs:{}};const root:Dir={files:{},dirs:{child:leaf}};const log:string[]=[];for(const k in root.dirs.child.files)log.push(k);assert.compareArray(log,['1','2','b','a']);
console.log("collections-record-numeric-keys:ok");
