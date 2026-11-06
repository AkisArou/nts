/*---
description: "An empty child pair is a leaf rather than a missing node. Route: binary-leaves"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// An empty child pair is a leaf rather than a missing node. Route: binary-leaves; node prints trees-binary-leaves:ok.
interface RouteBinaryNode {value:number;left:RouteBinaryNode|null;right:RouteBinaryNode|null}
type View=RouteBinaryNode;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
function leaves(n:View|null):number{if(n===null)return 0;if(n.left===null&&n.right===null)return 1;return leaves(n.left)+leaves(n.right);}
assert.sameValue(leaves(root),3);
console.log("trees-binary-leaves:ok");
