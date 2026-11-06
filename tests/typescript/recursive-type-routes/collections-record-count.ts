/*---
description: "Recursive directory nodes and files have exact counts. Route: record-count"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Recursive directory nodes and files have exact counts. Route: record-count. Node prints collections-record-count:ok.
interface Dir{files:Record<string,number>;dirs:Record<string,Dir>};type View=Dir;
const leaf:Dir={files:{last:-0},dirs:{}};const middle:Dir={files:{nan:NaN},dirs:{child:leaf}};const root:View={files:{top:2},dirs:{sub:middle}};
function count(d:View):number{let n=0;for(const key in d.files)n++;for(const key in d.dirs)n+=count(d.dirs[key]);return n;}
assert.sameValue(count(root),3);
console.log("collections-record-count:ok");
