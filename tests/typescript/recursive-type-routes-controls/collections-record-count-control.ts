/*---
description: "Recursive directory nodes and files have exact counts. Route: record-count (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Recursive directory nodes and files have exact counts. Route: record-count. Node prints collections-record-count:ok.
type D0={files:Record<string,number>;dirs:Record<string,never>};type D1={files:Record<string,number>;dirs:Record<string,D0>};type D2={files:Record<string,number>;dirs:Record<string,D1>};type View=D0|D1|D2;
const leaf:D0={files:{last:-0},dirs:{}};const middle:D1={files:{nan:NaN},dirs:{child:leaf}};const root:View={files:{top:2},dirs:{sub:middle}};
function count(d:View):number{let n=0;for(const key in d.files)n++;for(const key in d.dirs)n+=count(d.dirs[key]);return n;}
assert.sameValue(count(root),3);
console.log("collections-record-count:ok");
