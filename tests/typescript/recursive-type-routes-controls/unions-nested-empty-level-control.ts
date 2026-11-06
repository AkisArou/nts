/*---
description: "An empty recursive array contributes no leaves. Route: nested-empty-level (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// An empty recursive array contributes no leaves. Route: nested-empty-level. Node prints unions-nested-empty-level:ok.
type N0=number;type N1=N0|N0[];type N2=N0|N1[];type N3=N0|N2[];type View=N0|N1|N2|N3;
function flatten(v:View):number[]{if(typeof v==='number')return [v];const out:number[]=[];for(const child of v)out.push(...flatten(child));return out;}
const input:View=[[],[0,[]]];
assert.compareArray(flatten(input),[0]);
console.log("unions-nested-empty-level:ok");
