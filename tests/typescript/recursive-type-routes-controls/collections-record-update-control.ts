/*---
description: "A deep directory file update survives traversal. Route: record-update (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A deep directory file update survives traversal. Route: record-update. Node prints collections-record-update:ok.
type D0={files:Record<string,number>;dirs:Record<string,never>};type D1={files:Record<string,number>;dirs:Record<string,D0>};type D2={files:Record<string,number>;dirs:Record<string,D1>};type View=D0|D1|D2;
const leaf:D0={files:{last:-0},dirs:{}};const middle:D1={files:{nan:NaN},dirs:{child:leaf}};const root:View={files:{top:2},dirs:{sub:middle}};
leaf.files.last=7;function visit(dir:View):number[]{const out:number[]=[];for(const key in dir.files)out.push(dir.files[key]);for(const key in dir.dirs)out.push(...visit(dir.dirs[key]));return out;}
assert.compareArray(visit(root),[2,NaN,7]);
console.log("collections-record-update:ok");
