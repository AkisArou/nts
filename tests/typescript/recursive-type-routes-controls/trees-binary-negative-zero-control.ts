/*---
description: "A depth-two signed zero survives a recursive binary field. Route: binary-negative-zero (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// A depth-two signed zero survives a recursive binary field. Route: binary-negative-zero; node prints trees-binary-negative-zero:ok.
type B0={value:number;left:null;right:null};type B1={value:number;left:B0|null;right:B0|null};type B2={value:number;left:B1|null;right:B1|null};type View=B0|B1|B2;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
function value(n:View):number{return n.left===null?99:n.left.value;}
assert.sameValue(value(root),-0);
console.log("trees-binary-negative-zero:ok");
