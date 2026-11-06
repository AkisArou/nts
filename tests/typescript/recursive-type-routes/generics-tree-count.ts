/*---
description: "One generic tree walker counts three levels at either type argument. Route: tree-count"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// One generic tree walker counts three levels at either type argument. Route: tree-count. Node prints generics-tree-count:ok.
interface Tree<T>{value:T;children:Tree<T>[]};type View<T>=Tree<T>;
const numbers:View<number>={value:0,children:[{value:-0,children:[{value:NaN,children:[]}]}]};const strings:View<string>={value:'',children:[{value:'x',children:[{value:'y',children:[]}]}]};
function count<T>(n:View<T>):number{let x=1;for(const child of n.children)x+=count(child);return x;}
assert.sameValue(count<number>(numbers),3);assert.sameValue(count<string>(strings),3);
console.log("generics-tree-count:ok");
