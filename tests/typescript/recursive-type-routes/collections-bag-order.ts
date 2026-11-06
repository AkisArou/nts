/*---
description: "Recursive nested Sets retain insertion order. Route: bag-order"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Recursive nested Sets retain insertion order. Route: bag-order. Node prints collections-bag-order:ok.
type Bag=Set<number|Bag>;type View=Bag;
const leaf:Bag=new Set<number|Bag>([-0,NaN,3]);const middle:Bag=new Set<number|Bag>([leaf,5]);const root:View=new Set<number|Bag>([middle]);
const log:string[]=[];function walk(b:View):void{for(const item of b){if(typeof item==='number')log.push(String(item));else{log.push('set');walk(item);}}}walk(root);
assert.compareArray(log,["set","set","0","NaN","3","5"]);
console.log("collections-bag-order:ok");
