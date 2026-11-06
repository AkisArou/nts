/*---
description: "Recursive summation preserves each finite numeric leaf. Route: binary-finite-total"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Recursive summation preserves each finite numeric leaf. Route: binary-finite-total; node prints trees-binary-finite-total:ok.
interface RouteBinaryNode {value:number;left:RouteBinaryNode|null;right:RouteBinaryNode|null}
type View=RouteBinaryNode;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
function total(n:View|null):number{return n===null?0:(Number.isNaN(n.value)?0:n.value)+total(n.left)+total(n.right);}
assert.sameValue(total(root),8);
console.log("trees-binary-finite-total:ok");
