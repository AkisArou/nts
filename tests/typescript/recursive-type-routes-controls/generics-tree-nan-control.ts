/*---
description: "A generic numeric tree walker keeps NaN at depth three. Route: tree-nan (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A generic numeric tree walker keeps NaN at depth three. Route: tree-nan. Node prints generics-tree-nan:ok.
type L0<T>={value:T;children:[]};type L1<T>={value:T;children:L0<T>[]};type L2<T>={value:T;children:(L0<T>|L1<T>)[]};type View<T>=L0<T>|L1<T>|L2<T>;
const numbers:View<number>={value:0,children:[{value:-0,children:[{value:NaN,children:[]}]}]};const strings:View<string>={value:'',children:[{value:'x',children:[{value:'y',children:[]}]}]};
function flatten<T>(node:View<T>):T[]{const result:T[]=[];function visit(n:View<T>):void{result.push(n.value);for(const child of n.children)visit(child);}visit(node);return result;}
assert.sameValue(flatten<number>(numbers)[2],NaN);
console.log("generics-tree-nan:ok");
