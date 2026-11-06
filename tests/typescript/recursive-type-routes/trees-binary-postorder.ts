/*---
description: "Postorder visitation visits children before parents. Route: binary-postorder"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Postorder visitation visits children before parents. Route: binary-postorder; node prints trees-binary-postorder:ok.
interface RouteBinaryNode {value:number;left:RouteBinaryNode|null;right:RouteBinaryNode|null}
type View=RouteBinaryNode;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
const log:string[]=[];function walk(n:View|null):void{if(n===null)return;walk(n.left);walk(n.right);log.push(String(n.value));}walk(root);
assert.compareArray(log,["4","NaN","0","3","1"]);
console.log("trees-binary-postorder:ok");
