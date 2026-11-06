/*---
description: "A nested Map leaf mutation remains visible from its parent. Route: weighted-update"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A nested Map leaf mutation remains visible from its parent. Route: weighted-update. Node prints collections-weighted-update:ok.
type Weighted=Map<string,number|Weighted>;type View=Weighted;
const leaf:Weighted=new Map<string,number|Weighted>([["zero",-0],["nan",NaN]]);const middle:Weighted=new Map<string,number|Weighted>([["leaf",leaf],["other",5]]);const root:View=new Map<string,number|Weighted>([["middle",middle]]);
function collect(m:View):number[]{const out:number[]=[];for(const value of m.values()){if(typeof value==='number')out.push(value);else out.push(...collect(value));}return out;}
leaf.set('zero',12);
assert.sameValue(collect(root)[0],12);
console.log("collections-weighted-update:ok");
