/*---
description: "An inner recursive array retains NaN. Route: nested-nan (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// An inner recursive array retains NaN. Route: nested-nan. Node prints unions-nested-nan:ok.
type N0=number;type N1=N0|N0[];type N2=N0|N1[];type N3=N0|N2[];type View=N0|N1|N2|N3;
function flatten(v:View):number[]{if(typeof v==='number')return [v];const out:number[]=[];for(const child of v)out.push(...flatten(child));return out;}
const input:View=[0,[[NaN]]];
assert.compareArray(flatten(input),[0,NaN]);
console.log("unions-nested-nan:ok");
