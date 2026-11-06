/*---
description: "Recursive binary search tree insertion preserves node order. Route: typed recursive BST field"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Recursive binary search tree insertion preserves node order. Route: typed recursive BST field. Node prints trees-bst-insert:ok.
interface BST{value:number;left:BST|null;right:BST|null};
const root:BST={value:2,left:{value:1,left:null,right:null},right:{value:4,left:null,right:null}};function insert(n:BST,v:number):void{if(v<n.value){if(n.left===null)n.left={value:v,left:null,right:null};else insert(n.left,v);}else{if(n.right===null)n.right={value:v,left:null,right:null};else insert(n.right,v);}}insert(root,3);const found=root.right?.left;assert.sameValue(found?.value,3);
console.log("trees-bst-insert:ok");
