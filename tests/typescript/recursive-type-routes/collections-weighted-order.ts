/*---
description: "A recursive weighted Map keeps nested insertion order. Route: weighted-order"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A recursive weighted Map keeps nested insertion order. Route: weighted-order. Node prints collections-weighted-order:ok.
type Weighted=Map<string,number|Weighted>;type View=Weighted;
const leaf:Weighted=new Map<string,number|Weighted>([["zero",-0],["nan",NaN]]);const middle:Weighted=new Map<string,number|Weighted>([["leaf",leaf],["other",5]]);const root:View=new Map<string,number|Weighted>([["middle",middle]]);
const log:string[]=[];function walk(m:View):void{for(const [key,val]of m){log.push(key);if(typeof val!=='number')walk(val);}}walk(root);
assert.compareArray(log,["middle","leaf","zero","nan","other"]);
console.log("collections-weighted-order:ok");
