/*---
description: "A nested recursive Map deletion preserves remaining order. Route: weighted-delete"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A nested recursive Map deletion preserves remaining order. Route: weighted-delete. Node prints collections-weighted-delete:ok.
type Weighted=Map<string,number|Weighted>;type View=Weighted;
const leaf:Weighted=new Map<string,number|Weighted>([["zero",-0],["nan",NaN]]);const middle:Weighted=new Map<string,number|Weighted>([["leaf",leaf],["other",5]]);const root:View=new Map<string,number|Weighted>([["middle",middle]]);
function collect(m:View):number[]{const out:number[]=[];for(const value of m.values()){if(typeof value==='number')out.push(value);else out.push(...collect(value));}return out;}
leaf.delete('zero');
assert.compareArray(collect(root),[NaN,5]);
console.log("collections-weighted-delete:ok");
