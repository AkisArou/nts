/*---
description: "Recursive binary nodes retain their exact count. Route: binary-size"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Recursive binary nodes retain their exact count. Route: binary-size; node prints trees-binary-size:ok.
interface RouteBinaryNode {value:number;left:RouteBinaryNode|null;right:RouteBinaryNode|null}
type View=RouteBinaryNode;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
function count(n:View|null):number{return n===null?0:1+count(n.left)+count(n.right);}
assert.sameValue(count(root),5);
console.log("trees-binary-size:ok");
