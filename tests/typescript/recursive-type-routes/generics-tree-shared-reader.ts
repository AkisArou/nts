/*---
description: "Generic nested child readers preserve the correct type argument. Route: tree-shared-reader"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// Generic nested child readers preserve the correct type argument. Route: tree-shared-reader. Node prints generics-tree-shared-reader:ok.
interface Tree<T>{value:T;children:Tree<T>[]};type View<T>=Tree<T>;
const numbers:View<number>={value:0,children:[{value:-0,children:[{value:NaN,children:[]}]}]};const strings:View<string>={value:'',children:[{value:'x',children:[{value:'y',children:[]}]}]};
function first<T>(n:View<T>):T{return n.children[0].value;}
assert.sameValue(first<number>(numbers),-0);assert.sameValue(first<string>(strings),'x');
console.log("generics-tree-shared-reader:ok");
