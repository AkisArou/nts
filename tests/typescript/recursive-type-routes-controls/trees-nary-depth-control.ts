/*---
description: "An n-ary tree preserves the deepest descendant. Route: nary-depth (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// An n-ary tree preserves the deepest descendant. Route: nary-depth; node prints trees-nary-depth:ok.
type N0={value:number;children:[]};type N1={value:number;children:N0[]};type N2={value:number;children:(N0|N1)[]};type View=N0|N1|N2;
const root:View={value:1,children:[{value:2,children:[{value:4,children:[]}]},{value:3,children:[]}]};
function depth(n:View):number{let m=0;for(const child of n.children)m=Math.max(m,depth(child));return m+1;}
assert.sameValue(depth(root),3);
console.log("trees-nary-depth:ok");
