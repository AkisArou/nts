/*---
description: "A recursive weighted Map retains nested signed zero and NaN. Route: weighted-values (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A recursive weighted Map retains nested signed zero and NaN. Route: weighted-values. Node prints collections-weighted-values:ok.
type W0=Map<string,number>;type W1=Map<string,number|W0>;type W2=Map<string,number|W1>;type View=W0|W1|W2;
const leaf:W0=new Map<string,number>([["zero",-0],["nan",NaN]]);const middle:W1=new Map<string,number|W0>([["leaf",leaf],["other",5]]);const root:View=new Map<string,number|W1>([["middle",middle]]);
function collect(m:View):number[]{const out:number[]=[];for(const value of m.values()){if(typeof value==='number')out.push(value);else out.push(...collect(value));}return out;}
assert.compareArray(collect(root),[-0,NaN,5]);
console.log("collections-weighted-values:ok");
