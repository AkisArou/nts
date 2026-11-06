/*---
description: "A nested recursive numeric array preserves leaves across three depths. Route: nested-mixed-depth"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// A nested recursive numeric array preserves leaves across three depths. Route: nested-mixed-depth. Node prints unions-nested-mixed-depth:ok.
type Nested=number|Nested[];type View=Nested;
function flatten(v:View):number[]{if(typeof v==='number')return [v];const out:number[]=[];for(const child of v)out.push(...flatten(child));return out;}
const input:View=[1,[2,[3]],4];
assert.compareArray(flatten(input),[1,2,3,4]);
console.log("unions-nested-mixed-depth:ok");
