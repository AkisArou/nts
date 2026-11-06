/*---
description: "Recursive directory Records preserve nested file values. Route: record-values (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Recursive directory Records preserve nested file values. Route: record-values. Node prints collections-record-values:ok.
type D0={files:Record<string,number>;dirs:Record<string,never>};type D1={files:Record<string,number>;dirs:Record<string,D0>};type D2={files:Record<string,number>;dirs:Record<string,D1>};type View=D0|D1|D2;
const leaf:D0={files:{last:-0},dirs:{}};const middle:D1={files:{nan:NaN},dirs:{child:leaf}};const root:View={files:{top:2},dirs:{sub:middle}};
function visit(dir:View):number[]{const out:number[]=[];for(const key in dir.files)out.push(dir.files[key]);for(const key in dir.dirs)out.push(...visit(dir.dirs[key]));return out;}
assert.compareArray(visit(root),[2,NaN,-0]);
console.log("collections-record-values:ok");
