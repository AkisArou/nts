/*---
description: "A recursive weighted Map keeps nested insertion order. Route: weighted-order (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// A recursive weighted Map keeps nested insertion order. Route: weighted-order. Node prints collections-weighted-order:ok.
type W0=Map<string,number>;type W1=Map<string,number|W0>;type W2=Map<string,number|W1>;type View=W0|W1|W2;
const leaf:W0=new Map<string,number>([["zero",-0],["nan",NaN]]);const middle:W1=new Map<string,number|W0>([["leaf",leaf],["other",5]]);const root:View=new Map<string,number|W1>([["middle",middle]]);
const log:string[]=[];function walk(m:View):void{for(const [key,val]of m){log.push(key);if(typeof val!=='number')walk(val);}}walk(root);
assert.compareArray(log,["middle","leaf","zero","nan","other"]);
console.log("collections-weighted-order:ok");
