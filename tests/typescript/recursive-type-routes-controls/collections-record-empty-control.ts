/*---
description: "Empty recursive directory maps remain present. Route: record-empty (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Empty recursive directory maps remain present. Route: record-empty. Node prints collections-record-empty:ok.
type D0={files:Record<string,number>;dirs:Record<string,never>};type D1={files:Record<string,number>;dirs:Record<string,D0>};type D2={files:Record<string,number>;dirs:Record<string,D1>};type View=D0|D1|D2;
const leaf:D0={files:{last:-0},dirs:{}};const middle:D1={files:{nan:NaN},dirs:{child:leaf}};const root:View={files:{top:2},dirs:{sub:middle}};
const absent=leaf.dirs;
assert.sameValue('unknown' in absent,false);assert.sameValue(JSON.stringify(absent),'{}');
console.log("collections-record-empty:ok");
