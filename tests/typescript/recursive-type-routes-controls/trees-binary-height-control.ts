/*---
description: "Recursive binary nodes preserve tree height. Route: binary-height (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Recursive binary nodes preserve tree height. Route: binary-height; node prints trees-binary-height:ok.
type B0={value:number;left:null;right:null};type B1={value:number;left:B0|null;right:B0|null};type B2={value:number;left:B1|null;right:B1|null};type View=B0|B1|B2;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
function height(n:View|null):number{return n===null?0:1+Math.max(height(n.left),height(n.right));}
assert.sameValue(height(root),3);
console.log("trees-binary-height:ok");
