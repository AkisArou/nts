/*---
description: "Level-order visitation preserves breadth-first order. Route: binary-level-order"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Level-order visitation preserves breadth-first order. Route: binary-level-order; node prints trees-binary-level-order:ok.
interface RouteBinaryNode {value:number;left:RouteBinaryNode|null;right:RouteBinaryNode|null}
type View=RouteBinaryNode;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
const log:string[]=[];const queue:View[]=[root];for(let i=0;i<queue.length;i++){const n=queue[i];log.push(String(n.value));if(n.left!==null)queue.push(n.left);if(n.right!==null)queue.push(n.right);}
assert.compareArray(log,["1","0","3","4","NaN"]);
console.log("trees-binary-level-order:ok");
