/*---
description: "A nested Map leaf mutation remains visible from its parent. Route: weighted-update (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A nested Map leaf mutation remains visible from its parent. Route: weighted-update. Node prints collections-weighted-update:ok.
type W0=Map<string,number>;type W1=Map<string,number|W0>;type W2=Map<string,number|W1>;type View=W0|W1|W2;
const leaf:W0=new Map<string,number>([["zero",-0],["nan",NaN]]);const middle:W1=new Map<string,number|W0>([["leaf",leaf],["other",5]]);const root:View=new Map<string,number|W1>([["middle",middle]]);
function collect(m:View):number[]{const out:number[]=[];for(const value of m.values()){if(typeof value==='number')out.push(value);else out.push(...collect(value));}return out;}
leaf.set('zero',12);
assert.sameValue(collect(root)[0],12);
console.log("collections-weighted-update:ok");
