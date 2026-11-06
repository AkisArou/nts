/*---
description: "A generic deep tree write persists through recursive readers. Route: tree-mutation (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A generic deep tree write persists through recursive readers. Route: tree-mutation. Node prints generics-tree-mutation:ok.
type L0<T>={value:T;children:[]};type L1<T>={value:T;children:L0<T>[]};type L2<T>={value:T;children:(L0<T>|L1<T>)[]};type View<T>=L0<T>|L1<T>|L2<T>;
const numbers:View<number>={value:0,children:[{value:-0,children:[{value:NaN,children:[]}]}]};const strings:View<string>={value:'',children:[{value:'x',children:[{value:'y',children:[]}]}]};
function flatten<T>(node:View<T>):T[]{const result:T[]=[];function visit(n:View<T>):void{result.push(n.value);for(const child of n.children)visit(child);}visit(node);return result;}function setFirst<T>(n:View<T>,x:T):void{n.children[0].value=x;}setFirst<number>(numbers,7);setFirst<string>(strings,'q');
assert.sameValue(flatten<number>(numbers)[1],7);assert.sameValue(flatten<string>(strings)[1],'q');
console.log("generics-tree-mutation:ok");
