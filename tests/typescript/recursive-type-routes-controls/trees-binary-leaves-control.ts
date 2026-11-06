/*---
description: "An empty child pair is a leaf rather than a missing node. Route: binary-leaves (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// An empty child pair is a leaf rather than a missing node. Route: binary-leaves; node prints trees-binary-leaves:ok.
type B0={value:number;left:null;right:null};type B1={value:number;left:B0|null;right:B0|null};type B2={value:number;left:B1|null;right:B1|null};type View=B0|B1|B2;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
function leaves(n:View|null):number{if(n===null)return 0;if(n.left===null&&n.right===null)return 1;return leaves(n.left)+leaves(n.right);}
assert.sameValue(leaves(root),3);
console.log("trees-binary-leaves:ok");
