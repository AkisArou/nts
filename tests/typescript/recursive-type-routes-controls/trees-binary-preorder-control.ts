/*---
description: "Preorder visitation retains exact left-right order. Route: binary-preorder (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Preorder visitation retains exact left-right order. Route: binary-preorder; node prints trees-binary-preorder:ok.
type B0={value:number;left:null;right:null};type B1={value:number;left:B0|null;right:B0|null};type B2={value:number;left:B1|null;right:B1|null};type View=B0|B1|B2;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
const log:string[]=[];function walk(n:View|null):void{if(n===null)return;log.push(String(n.value));walk(n.left);walk(n.right);}walk(root);
assert.compareArray(log,["1","0","4","NaN","3"]);
console.log("trees-binary-preorder:ok");
