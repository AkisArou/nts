/*---
description: "A recursive search retains the path to a nested leaf. Route: binary-path (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// A recursive search retains the path to a nested leaf. Route: binary-path; node prints trees-binary-path:ok.
type B0={value:number;left:null;right:null};type B1={value:number;left:B0|null;right:B0|null};type B2={value:number;left:B1|null;right:B1|null};type View=B0|B1|B2;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
function path(n:View|null,v:number,p:string):string|undefined{if(n===null)return undefined;if(n.value===v)return p;const left=path(n.left,v,p+'L');return left!==undefined?left:path(n.right,v,p+'R');}
assert.sameValue(path(root,4,''),'LL');
console.log("trees-binary-path:ok");
