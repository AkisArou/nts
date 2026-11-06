/*---
description: "Recursive binary search tree lookup follows correct branches. Route: typed recursive BST field (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Recursive binary search tree lookup follows correct branches. Route: typed recursive BST field. Node prints trees-bst-find:ok.
interface Indexed{value:number;left:number;right:number};
const cells:Indexed[]=[{value:2,left:1,right:2},{value:1,left:-1,right:-1},{value:4,left:-1,right:-1}];function find(i:number,v:number):number|undefined{if(i===-1)return undefined;const n=cells[i];if(n.value===v)return n.value;return find(v<n.value?n.left:n.right,v);}assert.sameValue(find(0,4),4);assert.sameValue(find(0,3),undefined);
console.log("trees-bst-find:ok");
