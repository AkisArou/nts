/*---
description: "A nested recursive numeric array preserves leaves across three depths. Route: nested-mixed-depth (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// A nested recursive numeric array preserves leaves across three depths. Route: nested-mixed-depth. Node prints unions-nested-mixed-depth:ok.
type N0=number;type N1=N0|N0[];type N2=N0|N1[];type N3=N0|N2[];type View=N0|N1|N2|N3;
function flatten(v:View):number[]{if(typeof v==='number')return [v];const out:number[]=[];for(const child of v)out.push(...flatten(child));return out;}
const input:View=[1,[2,[3]],4];
assert.compareArray(flatten(input),[1,2,3,4]);
console.log("unions-nested-mixed-depth:ok");
