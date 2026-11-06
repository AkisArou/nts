/*---
description: "Recursive summation preserves each finite numeric leaf. Route: binary-finite-total (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Recursive summation preserves each finite numeric leaf. Route: binary-finite-total; node prints trees-binary-finite-total:ok.
type B0={value:number;left:null;right:null};type B1={value:number;left:B0|null;right:B0|null};type B2={value:number;left:B1|null;right:B1|null};type View=B0|B1|B2;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
function total(n:View|null):number{return n===null?0:(Number.isNaN(n.value)?0:n.value)+total(n.left)+total(n.right);}
assert.sameValue(total(root),8);
console.log("trees-binary-finite-total:ok");
