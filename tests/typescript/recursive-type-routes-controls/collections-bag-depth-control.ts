/*---
description: "Nested Set depth is retained through recursive aliases. Route: bag-depth (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-collections]
---*/

// Nested Set depth is retained through recursive aliases. Route: bag-depth. Node prints collections-bag-depth:ok.
type S0=Set<number>;type S1=Set<number|S0>;type S2=Set<number|S1>;type View=S0|S1|S2;
const leaf:S0=new Set<number>([-0,NaN,3]);const middle:S1=new Set<number|S0>([leaf,5]);const root:View=new Set<number|S1>([middle]);
function depth(b:View):number{let d=1;for(const item of b)if(typeof item!=='number')d=Math.max(d,1+depth(item));return d;}
assert.sameValue(depth(root),3);
console.log("collections-bag-depth:ok");
