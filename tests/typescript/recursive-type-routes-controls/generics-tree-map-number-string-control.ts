/*---
description: "A recursive generic tree map changes numbers to strings while retaining leaf order. Route: tree-map-number-string (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// A recursive generic tree map changes numbers to strings while retaining leaf order. Route: tree-map-number-string. Node prints generics-tree-map-number-string:ok.
type L0<T>={value:T;children:[]};type L1<T>={value:T;children:L0<T>[]};type L2<T>={value:T;children:L1<T>[]};type View<T>=L0<T>|L1<T>|L2<T>;
const root:L2<number>={value:0,children:[{value:-0,children:[{value:NaN,children:[]}]}]};function mapTree<A,B>(node:L2<A>,fn:(value:A)=>B):L2<B>{return{value:fn(node.value),children:node.children.map(child=>({value:fn(child.value),children:child.children.map(leaf=>({value:fn(leaf.value),children:[]}))}))};}
const mapped=mapTree<number,string>(root,v=>Object.is(v,-0)?'-0':String(v));assert.sameValue(mapped.value,'0');assert.sameValue(mapped.children[0].value,'-0');assert.sameValue(mapped.children[0].children[0].value,'NaN');
console.log("generics-tree-map-number-string:ok");
