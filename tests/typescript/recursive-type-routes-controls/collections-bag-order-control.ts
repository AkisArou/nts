/*---
description: "Recursive nested Sets retain insertion order. Route: bag-order (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Recursive nested Sets retain insertion order. Route: bag-order. Node prints collections-bag-order:ok.
type S0=Set<number>;type S1=Set<number|S0>;type S2=Set<number|S1>;type View=S0|S1|S2;
const leaf:S0=new Set<number>([-0,NaN,3]);const middle:S1=new Set<number|S0>([leaf,5]);const root:View=new Set<number|S1>([middle]);
const log:string[]=[];function walk(b:View):void{for(const item of b){if(typeof item==='number')log.push(String(item));else{log.push('set');walk(item);}}}walk(root);
assert.compareArray(log,["set","set","0","NaN","3","5"]);
console.log("collections-bag-order:ok");
