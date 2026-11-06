/*---
description: "An inner recursive array retains negative zero. Route: nested-negative-zero"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// An inner recursive array retains negative zero. Route: nested-negative-zero. Node prints unions-nested-negative-zero:ok.
type Nested=number|Nested[];type View=Nested;
function flatten(v:View):number[]{if(typeof v==='number')return [v];const out:number[]=[];for(const child of v)out.push(...flatten(child));return out;}
const input:View=[1,[[-0]]];
assert.compareArray(flatten(input),[1,-0]);
console.log("unions-nested-negative-zero:ok");
