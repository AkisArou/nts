/*---
description: "Recursive generic traversal preserves child identity between reads. Route: tree-reuse (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// Recursive generic traversal preserves child identity between reads. Route: tree-reuse. Node prints generics-tree-reuse:ok.
type L0<T>={value:T;children:[]};type L1<T>={value:T;children:L0<T>[]};type L2<T>={value:T;children:(L0<T>|L1<T>)[]};type View<T>=L0<T>|L1<T>|L2<T>;
const numbers:View<number>={value:0,children:[{value:-0,children:[{value:NaN,children:[]}]}]};const strings:View<string>={value:'',children:[{value:'x',children:[{value:'y',children:[]}]}]};
function first<T>(n:View<T>):View<T>{return n.children[0];}
assert.sameValue(first(numbers)===numbers.children[0],true);assert.sameValue(first(strings)===strings.children[0],true);
console.log("generics-tree-reuse:ok");
