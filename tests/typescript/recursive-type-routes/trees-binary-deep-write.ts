/*---
description: "A write at depth three remains visible through the root. Route: binary-deep-write"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// A write at depth three remains visible through the root. Route: binary-deep-write; node prints trees-binary-deep-write:ok.
interface RouteBinaryNode {value:number;left:RouteBinaryNode|null;right:RouteBinaryNode|null}
type View=RouteBinaryNode;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
function change(n:View|null):void{if(n===null)return;if(Number.isNaN(n.value))n.value=9;change(n.left);change(n.right);}change(root);
assert.sameValue(root.left?.right?.value,9);
console.log("trees-binary-deep-write:ok");
