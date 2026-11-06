/*---
description: "A generic string tree walker retains an empty root string. Route: tree-empty-string"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A generic string tree walker retains an empty root string. Route: tree-empty-string. Node prints generics-tree-empty-string:ok.
interface Tree<T>{value:T;children:Tree<T>[]};type View<T>=Tree<T>;
const numbers:View<number>={value:0,children:[{value:-0,children:[{value:NaN,children:[]}]}]};const strings:View<string>={value:'',children:[{value:'x',children:[{value:'y',children:[]}]}]};
function flatten<T>(node:View<T>):T[]{const result:T[]=[];function visit(n:View<T>):void{result.push(n.value);for(const child of n.children)visit(child);}visit(node);return result;}
assert.sameValue(flatten<string>(strings)[0],'');
console.log("generics-tree-empty-string:ok");
