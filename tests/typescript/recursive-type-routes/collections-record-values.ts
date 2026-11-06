/*---
description: "Recursive directory Records preserve nested file values. Route: record-values"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Recursive directory Records preserve nested file values. Route: record-values. Node prints collections-record-values:ok.
interface Dir{files:Record<string,number>;dirs:Record<string,Dir>};type View=Dir;
const leaf:Dir={files:{last:-0},dirs:{}};const middle:Dir={files:{nan:NaN},dirs:{child:leaf}};const root:View={files:{top:2},dirs:{sub:middle}};
function visit(dir:View):number[]{const out:number[]=[];for(const key in dir.files)out.push(dir.files[key]);for(const key in dir.dirs)out.push(...visit(dir.dirs[key]));return out;}
assert.compareArray(visit(root),[2,NaN,-0]);
console.log("collections-record-values:ok");
