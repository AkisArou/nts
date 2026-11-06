/*---
description: "An empty recursive array contributes no leaves. Route: nested-empty-level"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// An empty recursive array contributes no leaves. Route: nested-empty-level. Node prints unions-nested-empty-level:ok.
type Nested=number|Nested[];type View=Nested;
function flatten(v:View):number[]{if(typeof v==='number')return [v];const out:number[]=[];for(const child of v)out.push(...flatten(child));return out;}
const input:View=[[],[0,[]]];
assert.compareArray(flatten(input),[0]);
console.log("unions-nested-empty-level:ok");
