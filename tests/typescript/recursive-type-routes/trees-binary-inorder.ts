/*---
description: "In-order visitation preserves left-root-right order. Route: binary-inorder"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// In-order visitation preserves left-root-right order. Route: binary-inorder; node prints trees-binary-inorder:ok.
interface RouteBinaryNode {value:number;left:RouteBinaryNode|null;right:RouteBinaryNode|null}
type View=RouteBinaryNode;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
const log:string[]=[];function walk(n:View|null):void{if(n===null)return;walk(n.left);log.push(String(n.value));walk(n.right);}walk(root);
assert.compareArray(log,["4","0","NaN","1","3"]);
console.log("trees-binary-inorder:ok");
