/*---
description: "An n-ary tree preserves the deepest descendant. Route: nary-depth"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// An n-ary tree preserves the deepest descendant. Route: nary-depth; node prints trees-nary-depth:ok.
interface RouteNaryNode{value:number;children:RouteNaryNode[]}
type View=RouteNaryNode;
const root:View={value:1,children:[{value:2,children:[{value:4,children:[]}]},{value:3,children:[]}]};
function depth(n:View):number{let m=0;for(const child of n.children)m=Math.max(m,depth(child));return m+1;}
assert.sameValue(depth(root),3);
console.log("trees-nary-depth:ok");
