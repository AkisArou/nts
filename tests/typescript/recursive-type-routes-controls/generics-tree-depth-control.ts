/*---
description: "A generic recursive tree retains exact depth at both type arguments. Route: tree-depth (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A generic recursive tree retains exact depth at both type arguments. Route: tree-depth. Node prints generics-tree-depth:ok.
type L0<T>={value:T;children:[]};type L1<T>={value:T;children:L0<T>[]};type L2<T>={value:T;children:(L0<T>|L1<T>)[]};type View<T>=L0<T>|L1<T>|L2<T>;
const numbers:View<number>={value:0,children:[{value:-0,children:[{value:NaN,children:[]}]}]};const strings:View<string>={value:'',children:[{value:'x',children:[{value:'y',children:[]}]}]};
function depth<T>(n:View<T>):number{let d=0;for(const child of n.children)d=Math.max(d,depth(child));return d+1;}
assert.sameValue(depth<number>(numbers),3);assert.sameValue(depth<string>(strings),3);
console.log("generics-tree-depth:ok");
