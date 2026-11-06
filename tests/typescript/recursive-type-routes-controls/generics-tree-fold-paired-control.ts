/*---
description: "One recursive generic fold retains number and string measurements. Route: tree-fold-paired (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-generics]
---*/

// One recursive generic fold retains number and string measurements. Route: tree-fold-paired. Node prints generics-tree-fold-paired:ok.
type L0<T>={value:T;children:[]};type L1<T>={value:T;children:L0<T>[]};type L2<T>={value:T;children:L1<T>[]};type View<T>=L0<T>|L1<T>|L2<T>;
const numbers:View<number>={value:0,children:[{value:-0,children:[{value:NaN,children:[]}]}]};const texts:View<string>={value:'',children:[{value:'x',children:[{value:'y',children:[]}]}]};
function fold<T>(n:View<T>,measure:(value:T)=>number):number{let count=measure(n.value);for(const child of n.children)count+=fold(child,measure);return count;}
assert.sameValue(fold<number>(numbers,n=>Number.isNaN(n)?3:1),5);assert.sameValue(fold<string>(texts,s=>s.length),2);
console.log("generics-tree-fold-paired:ok");
