/*---
description: "An n-ary tree visits its children in insertion order. Route: nary-preorder (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// An n-ary tree visits its children in insertion order. Route: nary-preorder; node prints trees-nary-preorder:ok.
type N0={value:number;children:[]};type N1={value:number;children:N0[]};type N2={value:number;children:(N0|N1)[]};type View=N0|N1|N2;
const root:View={value:1,children:[{value:2,children:[{value:4,children:[]}]},{value:3,children:[]}]};
const log:string[]=[];function walk(n:View):void{log.push(String(n.value));for(const child of n.children)walk(child);}walk(root);
assert.compareArray(log,["1","2","4","3"]);
console.log("trees-nary-preorder:ok");
