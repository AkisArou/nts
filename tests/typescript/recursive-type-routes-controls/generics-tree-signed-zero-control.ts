/*---
description: "A generic numeric tree walker keeps the sign of a nested zero. Route: tree-signed-zero (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A generic numeric tree walker keeps the sign of a nested zero. Route: tree-signed-zero. Node prints generics-tree-signed-zero:ok.
type L0<T>={value:T;children:[]};type L1<T>={value:T;children:L0<T>[]};type L2<T>={value:T;children:(L0<T>|L1<T>)[]};type View<T>=L0<T>|L1<T>|L2<T>;
const numbers:View<number>={value:0,children:[{value:-0,children:[{value:NaN,children:[]}]}]};const strings:View<string>={value:'',children:[{value:'x',children:[{value:'y',children:[]}]}]};
function flatten<T>(node:View<T>):T[]{const result:T[]=[];function visit(n:View<T>):void{result.push(n.value);for(const child of n.children)visit(child);}visit(node);return result;}
assert.sameValue(flatten<number>(numbers)[1],-0);
console.log("generics-tree-signed-zero:ok");
