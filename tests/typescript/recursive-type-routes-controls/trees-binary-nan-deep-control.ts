/*---
description: "A depth-three NaN remains NaN through nested nodes. Route: binary-nan-deep (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// A depth-three NaN remains NaN through nested nodes. Route: binary-nan-deep; node prints trees-binary-nan-deep:ok.
type B0={value:number;left:null;right:null};type B1={value:number;left:B0|null;right:B0|null};type B2={value:number;left:B1|null;right:B1|null};type View=B0|B1|B2;
const root:View={value:1,left:{value:-0,left:{value:4,left:null,right:null},right:{value:NaN,left:null,right:null}},right:{value:3,left:null,right:null}};
function find(n:View|null):number|undefined{if(n===null)return undefined;if(Number.isNaN(n.value))return n.value;const l=find(n.left);return l!==undefined?l:find(n.right);}
assert.sameValue(find(root),NaN);
console.log("trees-binary-nan-deep:ok");
