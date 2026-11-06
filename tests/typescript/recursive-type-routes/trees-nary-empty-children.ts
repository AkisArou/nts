/*---
description: "A nested empty children array stays present. Route: nary-empty-children"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// A nested empty children array stays present. Route: nary-empty-children; node prints trees-nary-empty-children:ok.
interface RouteNaryNode{value:number;children:RouteNaryNode[]}
type View=RouteNaryNode;
const root:View={value:1,children:[{value:2,children:[{value:4,children:[]}]},{value:3,children:[]}]};
const node=root.children[1];
assert.sameValue(Array.isArray(node.children),true);assert.sameValue(node.children.length,0);
console.log("trees-nary-empty-children:ok");
