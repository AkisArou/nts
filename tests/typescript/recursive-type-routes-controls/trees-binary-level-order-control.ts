/*---
description: "Level-order visitation preserves breadth-first order. Route: binary-level-order (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Level-order visitation preserves breadth-first order. Route: binary-level-order; node prints trees-binary-level-order:ok.
type B0={value:number;left:null;right:null};type B1={value:number;left:B0|null;right:B0|null};type B2={value:number;left:B1|null;right:B1|null};type View=B0|B1|B2;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
const log:string[]=[];const queue:View[]=[root];for(let i=0;i<queue.length;i++){const n=queue[i];log.push(String(n.value));if(n.left!==null)queue.push(n.left);if(n.right!==null)queue.push(n.right);}
assert.compareArray(log,["1","0","3","4","NaN"]);
console.log("trees-binary-level-order:ok");
