/*---
description: "Recursive binary search tree lookup follows correct branches. Route: typed recursive BST field"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Recursive binary search tree lookup follows correct branches. Route: typed recursive BST field. Node prints trees-bst-find:ok.
interface BST{value:number;left:BST|null;right:BST|null};
const root:BST={value:2,left:{value:1,left:null,right:null},right:{value:4,left:null,right:null}};function find(n:BST|null,v:number):number|undefined{if(n===null)return undefined;if(n.value===v)return n.value;return find(v<n.value?n.left:n.right,v);}assert.sameValue(find(root,4),4);assert.sameValue(find(root,3),undefined);
console.log("trees-bst-find:ok");
