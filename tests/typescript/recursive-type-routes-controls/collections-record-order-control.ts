/*---
description: "Recursive directory Records preserve depth-first key order. Route: record-order (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Recursive directory Records preserve depth-first key order. Route: record-order. Node prints collections-record-order:ok.
type D0={files:Record<string,number>;dirs:Record<string,never>};type D1={files:Record<string,number>;dirs:Record<string,D0>};type D2={files:Record<string,number>;dirs:Record<string,D1>};type View=D0|D1|D2;
const leaf:D0={files:{last:-0},dirs:{}};const middle:D1={files:{nan:NaN},dirs:{child:leaf}};const root:View={files:{top:2},dirs:{sub:middle}};
const log:string[]=[];function walk(d:View):void{for(const k in d.files)log.push(k);for(const k in d.dirs){log.push(k);walk(d.dirs[k]);}}walk(root);
assert.compareArray(log,["top","sub","nan","child","last"]);
console.log("collections-record-order:ok");
