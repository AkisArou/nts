/*---
description: "One generic tree walker counts three levels at either type argument. Route: tree-count (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// One generic tree walker counts three levels at either type argument. Route: tree-count. Node prints generics-tree-count:ok.
type L0<T>={value:T;children:[]};type L1<T>={value:T;children:L0<T>[]};type L2<T>={value:T;children:(L0<T>|L1<T>)[]};type View<T>=L0<T>|L1<T>|L2<T>;
const numbers:View<number>={value:0,children:[{value:-0,children:[{value:NaN,children:[]}]}]};const strings:View<string>={value:'',children:[{value:'x',children:[{value:'y',children:[]}]}]};
function count<T>(n:View<T>):number{let x=1;for(const child of n.children)x+=count(child);return x;}
assert.sameValue(count<number>(numbers),3);assert.sameValue(count<string>(strings),3);
console.log("generics-tree-count:ok");
