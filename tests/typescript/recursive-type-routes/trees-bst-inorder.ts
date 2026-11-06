/*---
description: "Recursive binary search tree in-order traversal retains sorted keys. Route: typed recursive BST field"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Recursive binary search tree in-order traversal retains sorted keys. Route: typed recursive BST field. Node prints trees-bst-inorder:ok.
interface BST{value:number;left:BST|null;right:BST|null};
const root:BST={value:2,left:{value:1,left:null,right:null},right:{value:4,left:null,right:null}};const log:string[]=[];function visit(n:BST|null):void{if(n===null)return;visit(n.left);log.push(String(n.value));visit(n.right);}visit(root);assert.compareArray(log,["1","2","4"]);
console.log("trees-bst-inorder:ok");
