/*---
description: "An n-ary tree visits its children in insertion order. Route: nary-preorder"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// An n-ary tree visits its children in insertion order. Route: nary-preorder; node prints trees-nary-preorder:ok.
interface RouteNaryNode{value:number;children:RouteNaryNode[]}
type View=RouteNaryNode;
const root:View={value:1,children:[{value:2,children:[{value:4,children:[]}]},{value:3,children:[]}]};
const log:string[]=[];function walk(n:View):void{log.push(String(n.value));for(const child of n.children)walk(child);}walk(root);
assert.compareArray(log,["1","2","4","3"]);
console.log("trees-nary-preorder:ok");
