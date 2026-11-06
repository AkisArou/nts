/*---
description: "In-order visitation preserves left-root-right order. Route: binary-inorder (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// In-order visitation preserves left-root-right order. Route: binary-inorder; node prints trees-binary-inorder:ok.
type B0={value:number;left:null;right:null};type B1={value:number;left:B0|null;right:B0|null};type B2={value:number;left:B1|null;right:B1|null};type View=B0|B1|B2;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
const log:string[]=[];function walk(n:View|null):void{if(n===null)return;walk(n.left);log.push(String(n.value));walk(n.right);}walk(root);
assert.compareArray(log,["4","0","NaN","1","3"]);
console.log("trees-binary-inorder:ok");
