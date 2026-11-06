/*---
description: "A recursive search retains the path to a nested leaf. Route: binary-path"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// A recursive search retains the path to a nested leaf. Route: binary-path; node prints trees-binary-path:ok.
interface RouteBinaryNode {value:number;left:RouteBinaryNode|null;right:RouteBinaryNode|null}
type View=RouteBinaryNode;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
function path(n:View|null,v:number,p:string):string|undefined{if(n===null)return undefined;if(n.value===v)return p;const left=path(n.left,v,p+'L');return left!==undefined?left:path(n.right,v,p+'R');}
assert.sameValue(path(root,4,''),'LL');
console.log("trees-binary-path:ok");
