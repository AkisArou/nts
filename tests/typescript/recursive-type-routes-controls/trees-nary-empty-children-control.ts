/*---
description: "A nested empty children array stays present. Route: nary-empty-children (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// A nested empty children array stays present. Route: nary-empty-children; node prints trees-nary-empty-children:ok.
type N0={value:number;children:[]};type N1={value:number;children:N0[]};type N2={value:number;children:(N0|N1)[]};type View=N0|N1|N2;
const root:View={value:1,children:[{value:2,children:[{value:4,children:[]}]},{value:3,children:[]}]};
const node=root.children[1];
assert.sameValue(Array.isArray(node.children),true);assert.sameValue(node.children.length,0);
console.log("trees-nary-empty-children:ok");
