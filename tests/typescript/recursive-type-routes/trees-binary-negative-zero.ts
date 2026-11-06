/*---
description: "A depth-two signed zero survives a recursive binary field. Route: binary-negative-zero"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// A depth-two signed zero survives a recursive binary field. Route: binary-negative-zero; node prints trees-binary-negative-zero:ok.
interface RouteBinaryNode {value:number;left:RouteBinaryNode|null;right:RouteBinaryNode|null}
type View=RouteBinaryNode;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
function value(n:View):number{return n.left===null?99:n.left.value;}
assert.sameValue(value(root),-0);
console.log("trees-binary-negative-zero:ok");
