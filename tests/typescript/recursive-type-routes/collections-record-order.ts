/*---
description: "Recursive directory Records preserve depth-first key order. Route: record-order"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Recursive directory Records preserve depth-first key order. Route: record-order. Node prints collections-record-order:ok.
interface Dir{files:Record<string,number>;dirs:Record<string,Dir>};type View=Dir;
const leaf:Dir={files:{last:-0},dirs:{}};const middle:Dir={files:{nan:NaN},dirs:{child:leaf}};const root:View={files:{top:2},dirs:{sub:middle}};
const log:string[]=[];function walk(d:View):void{for(const k in d.files)log.push(k);for(const k in d.dirs){log.push(k);walk(d.dirs[k]);}}walk(root);
assert.compareArray(log,["top","sub","nan","child","last"]);
console.log("collections-record-order:ok");
