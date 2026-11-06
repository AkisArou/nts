/*---
description: "A generic recursive tree retains exact depth at both type arguments. Route: tree-depth"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A generic recursive tree retains exact depth at both type arguments. Route: tree-depth. Node prints generics-tree-depth:ok.
interface Tree<T>{value:T;children:Tree<T>[]};type View<T>=Tree<T>;
const numbers:View<number>={value:0,children:[{value:-0,children:[{value:NaN,children:[]}]}]};const strings:View<string>={value:'',children:[{value:'x',children:[{value:'y',children:[]}]}]};
function depth<T>(n:View<T>):number{let d=0;for(const child of n.children)d=Math.max(d,depth(child));return d+1;}
assert.sameValue(depth<number>(numbers),3);assert.sameValue(depth<string>(strings),3);
console.log("generics-tree-depth:ok");
