/*---
description: "Recursive binary search tree in-order traversal retains sorted keys. Route: typed recursive BST field (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-trees]
---*/

// Recursive binary search tree in-order traversal retains sorted keys. Route: typed recursive BST field. Node prints trees-bst-inorder:ok.
interface Indexed{value:number;left:number;right:number};
const cells:Indexed[]=[{value:2,left:1,right:2},{value:1,left:-1,right:-1},{value:4,left:-1,right:-1}];const log:string[]=[];function visit(i:number):void{if(i===-1)return;const n=cells[i];visit(n.left);log.push(String(n.value));visit(n.right);}visit(0);assert.compareArray(log,["1","2","4"]);
console.log("trees-bst-inorder:ok");
