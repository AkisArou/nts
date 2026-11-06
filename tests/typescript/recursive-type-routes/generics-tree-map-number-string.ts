/*---
description: "A recursive generic tree map changes numbers to strings while retaining leaf order. Route: tree-map-number-string"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A recursive generic tree map changes numbers to strings while retaining leaf order. Route: tree-map-number-string. Node prints generics-tree-map-number-string:ok.
interface Tree<T>{value:T;children:Tree<T>[]};type View<T>=Tree<T>;
const root:View<number>={value:0,children:[{value:-0,children:[{value:NaN,children:[]}]}]};function mapTree<A,B>(node:Tree<A>,fn:(value:A)=>B):Tree<B>{return{value:fn(node.value),children:node.children.map(child=>mapTree(child,fn))};}
const mapped=mapTree<number,string>(root,v=>Object.is(v,-0)?'-0':String(v));assert.sameValue(mapped.value,'0');assert.sameValue(mapped.children[0].value,'-0');assert.sameValue(mapped.children[0].children[0].value,'NaN');
console.log("generics-tree-map-number-string:ok");
