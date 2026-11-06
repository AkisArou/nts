/*---
description: "Generic nested child readers preserve the correct type argument. Route: tree-shared-reader (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// Generic nested child readers preserve the correct type argument. Route: tree-shared-reader. Node prints generics-tree-shared-reader:ok.
type L0<T>={value:T;children:[]};type L1<T>={value:T;children:L0<T>[]};type L2<T>={value:T;children:(L0<T>|L1<T>)[]};type View<T>=L0<T>|L1<T>|L2<T>;
const numbers:View<number>={value:0,children:[{value:-0,children:[{value:NaN,children:[]}]}]};const strings:View<string>={value:'',children:[{value:'x',children:[{value:'y',children:[]}]}]};
function first<T>(n:View<T>):T{return n.children[0].value;}
assert.sameValue(first<number>(numbers),-0);assert.sameValue(first<string>(strings),'x');
console.log("generics-tree-shared-reader:ok");
