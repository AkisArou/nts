/*---
description: "Preorder visitation retains exact left-right order. Route: binary-preorder"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Preorder visitation retains exact left-right order. Route: binary-preorder; node prints trees-binary-preorder:ok.
interface RouteBinaryNode {value:number;left:RouteBinaryNode|null;right:RouteBinaryNode|null}
type View=RouteBinaryNode;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
const log:string[]=[];function walk(n:View|null):void{if(n===null)return;log.push(String(n.value));walk(n.left);walk(n.right);}walk(root);
assert.compareArray(log,["1","0","4","NaN","3"]);
console.log("trees-binary-preorder:ok");
