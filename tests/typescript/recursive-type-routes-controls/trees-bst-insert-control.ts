/*---
description: "Recursive binary search tree insertion preserves node order. Route: typed recursive BST field (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Recursive binary search tree insertion preserves node order. Route: typed recursive BST field. Node prints trees-bst-insert:ok.
interface Indexed{value:number;left:number;right:number};
const cells:Indexed[]=[{value:2,left:1,right:2},{value:1,left:-1,right:-1},{value:4,left:-1,right:-1}];function insert(i:number,v:number):void{const n=cells[i];if(v<n.value){if(n.left===-1){n.left=cells.length;cells.push({value:v,left:-1,right:-1});}else insert(n.left,v);}else{if(n.right===-1){n.right=cells.length;cells.push({value:v,left:-1,right:-1});}else insert(n.right,v);}}insert(0,3);assert.sameValue(cells[cells[2].left].value,3);
console.log("trees-bst-insert:ok");
