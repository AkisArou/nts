/*---
description: "Empty recursive directory maps remain present. Route: record-empty"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Empty recursive directory maps remain present. Route: record-empty. Node prints collections-record-empty:ok.
interface Dir{files:Record<string,number>;dirs:Record<string,Dir>};type View=Dir;
const leaf:Dir={files:{last:-0},dirs:{}};const middle:Dir={files:{nan:NaN},dirs:{child:leaf}};const root:View={files:{top:2},dirs:{sub:middle}};
const absent=leaf.dirs;
assert.sameValue('unknown' in absent,false);assert.sameValue(JSON.stringify(absent),'{}');
console.log("collections-record-empty:ok");
