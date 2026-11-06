/*---
description: "A deep directory file update survives traversal. Route: record-update"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A deep directory file update survives traversal. Route: record-update. Node prints collections-record-update:ok.
interface Dir{files:Record<string,number>;dirs:Record<string,Dir>};type View=Dir;
const leaf:Dir={files:{last:-0},dirs:{}};const middle:Dir={files:{nan:NaN},dirs:{child:leaf}};const root:View={files:{top:2},dirs:{sub:middle}};
leaf.files.last=7;function visit(dir:View):number[]{const out:number[]=[];for(const key in dir.files)out.push(dir.files[key]);for(const key in dir.dirs)out.push(...visit(dir.dirs[key]));return out;}
assert.compareArray(visit(root),[2,NaN,7]);
console.log("collections-record-update:ok");
