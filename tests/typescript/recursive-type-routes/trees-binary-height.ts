/*---
description: "Recursive binary nodes preserve tree height. Route: binary-height"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Recursive binary nodes preserve tree height. Route: binary-height; node prints trees-binary-height:ok.
interface RouteBinaryNode {value:number;left:RouteBinaryNode|null;right:RouteBinaryNode|null}
type View=RouteBinaryNode;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
function height(n:View|null):number{return n===null?0:1+Math.max(height(n.left),height(n.right));}
assert.sameValue(height(root),3);
console.log("trees-binary-height:ok");
